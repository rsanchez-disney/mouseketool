import { Subject, Observable } from "rxjs";
import { DescribeLogStreamsCommand, GetLogEventsCommand, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { GetQueueAttributesCommand, QueueAttributeName, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { GetFunctionCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { getSqsClient } from "../helpers/sqs-client.js";
import { extractLogsFromPayload } from "../helpers/lambda-diagnostics.js";
import { localClassDiagnose, getDeploymentInfo } from "../helpers/lambda-diagnostics.js";
import { getCapturedPayload } from "./shadow-infra.js";
import { loadSettings } from "../helpers/settings.js";
import { PIPELINES_FILE, SETTINGS_DIR } from "../config/constants.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

// --- Types ---

export interface Pipeline {
  id: string; name: string; sourceType: string; tableName: string;
  topicName: string; topicArn: string; queueName: string; queueUrl: string;
  glueFunctionName: string; targetFunctionName: string; uuids: string[];
  subscriptionArn?: string; filterPolicy?: Record<string, unknown>; filterPolicyScope?: string;
  shadowSubscriptionArn?: string;
  topicCreatedByUs?: boolean; queueCreatedByUs?: boolean;
  vaultConfig?: { url: string; token: string; paths: string[] };
  envVars: { key: string; value: string }[]; addons: string[];
  runs: PipelineRun[]; createdAt: string;
}

export interface PipelineRun {
  id: string; timestamp: number; item?: string | null; source: "manual" | "external";
  handler: { requestId: string; logs: string[]; error: boolean };
  sns?: { status: string; logs: string[] };
  sqs?: { status: string; logs: string[] };
  target: { requestId: string; logs: string[]; error: boolean } | null;
  status: string;
  diagAvailable?: boolean;
}

export interface StepUpdate {
  pipelineId: string; runId: string; step: string; status: string; logs: string[]; elapsed?: number;
}

// --- Persistence ---

export function loadPipelines(): Pipeline[] {
  try { return JSON.parse(readFileSync(PIPELINES_FILE, "utf-8")); } catch { return []; }
}
export function savePipelines(p: Pipeline[]) {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(PIPELINES_FILE, JSON.stringify(p, null, 2));
}

// --- Manual run registry ---

const manualRuns = new Map<string, number>();
export function registerManualRun(pipelineId: string) {
  manualRuns.set(pipelineId, Date.now());
  console.log(`[watcher] Registered manual run for pipeline ${pipelineId}`);
}
function checkManualRun(pipelineId: string, timestamp: number): boolean {
  const registered = manualRuns.get(pipelineId);
  if (registered && timestamp - registered < 120000) { manualRuns.delete(pipelineId); return true; }
  return false;
}

// --- CloudWatch client ---

async function getCWClient() {
  const s = await loadSettings();
  const { CloudWatchLogsClient } = await import("@aws-sdk/client-cloudwatch-logs");
  return new CloudWatchLogsClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region, credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}

// --- PipelineWatcher ---

class PipelineWatcher {
  private newRun$ = new Subject<{ pipelineId: string; run: PipelineRun }>();
  private stepUpdate$ = new Subject<StepUpdate>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private knownRequestIds = new Set<string>();
  private pollCount = 0;

  get onNewRun(): Observable<{ pipelineId: string; run: PipelineRun }> { return this.newRun$.asObservable(); }
  get onStepUpdate(): Observable<StepUpdate> { return this.stepUpdate$.asObservable(); }

  start() {
    if (this.interval) return;
    const pipelines = loadPipelines();
    for (const p of pipelines) for (const r of p.runs) this.knownRequestIds.add(r.id);
    console.log(`[watcher] Started — monitoring ${pipelines.length} pipeline(s), ${this.knownRequestIds.size} known run(s)`);
    this.interval = setInterval(() => this.poll(), 2000);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    console.log("[watcher] Stopped");
  }

  private async poll() {
    try {
    const pipelines = loadPipelines();
    if (!pipelines.length) return;
    this.pollCount++;
    if (this.pollCount % 15 === 0) console.log(`[watcher] Poll #${this.pollCount} — ${pipelines.length} pipeline(s), ${this.knownRequestIds.size} known run(s)`);

    const cw = await getCWClient();
    for (const pipeline of pipelines) {
      try {
        const logGroup = `/aws/lambda/${pipeline.glueFunctionName}`;
        const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 3 }));
        for (const stream of streams.logStreams ?? []) {
          const since = Date.now() - 300000;
          const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: stream.logStreamName!, startTime: since, startFromHead: true, limit: 200 }));
          let reqId = "", logs: string[] = [], ts = 0, hasError = false;
          for (const e of events.events ?? []) {
            const msg = e.message?.trimEnd() ?? "";
            const m = msg.match(/^START RequestId: ([\w-]+)/);
            if (m) {
              if (reqId && !this.knownRequestIds.has(reqId)) this.detected(pipeline, reqId, ts, logs, hasError);
              reqId = m[1]; logs = [msg]; ts = e.timestamp ?? Date.now(); hasError = false;
            } else if (reqId) {
              logs.push(msg);
              if (/^\d{4}-\d{2}-\d{2}T.+\bERROR\b/.test(msg)) hasError = true;
            }
          }
          if (reqId && !this.knownRequestIds.has(reqId)) this.detected(pipeline, reqId, ts, logs, hasError);
        }
      } catch {}
    }
    } catch (e: any) { /* LocalStack unreachable — silently skip this poll cycle */ }
  }

  private detected(pipeline: Pipeline, requestId: string, timestamp: number, logs: string[], error: boolean) {
    this.knownRequestIds.add(requestId);
    const itemLine = logs.find(l => l.includes("Item:")) || logs.find(l => l.includes("DynamoDB Record:"));
    const item = itemLine ? itemLine.replace(/.*(?:Item|DynamoDB Record):\s*/, "") : null;
    const source = checkManualRun(pipeline.id, timestamp) ? "manual" as const : "external" as const;

    console.log(`[watcher] New run detected — pipeline: ${pipeline.name}, requestId: ${requestId.slice(0, 8)}, source: ${source}, error: ${error}`);

    // Extract handler duration from REPORT line
    const reportLine = logs.find(l => l.includes("REPORT RequestId"));
    const durationMatch = reportLine?.match(/Duration:\s*([\d.]+)\s*ms/);
    const handlerElapsed = durationMatch ? Math.round(parseFloat(durationMatch[1])) : undefined;

    const run: PipelineRun = {
      id: requestId, timestamp, item, source,
      handler: { requestId, logs, error, elapsed: handlerElapsed } as any,
      sns: error ? { status: "skipped", logs: ["Skipped — stream handler failed"] } : undefined,
      sqs: error ? { status: "skipped", logs: ["Skipped — stream handler failed"] } : undefined,
      target: null, status: error ? "error" : "pending",
    };

    const pipelines = loadPipelines();
    const p = pipelines.find(pp => pp.id === pipeline.id);
    if (p) { p.runs.push(run); savePipelines(pipelines); }

    this.newRun$.next({ pipelineId: pipeline.id, run });

    if (!error) {
      console.log(`[watcher] Spawning observer thread for run ${requestId.slice(0, 8)}`);
      this.spawnObserver(pipeline, run);
    } else {
      console.log(`[watcher] Stream handler failed for run ${requestId.slice(0, 8)} — no observer needed`);
    }
  }

  private async spawnObserver(pipeline: Pipeline, run: PipelineRun) {
    const tag = `[observer:${run.id.slice(0, 8)}]`;
    console.log(`${tag} Started for pipeline "${pipeline.name}" (target: ${pipeline.targetFunctionName})`);

    const stepTimers: Record<string, number> = {};
    const send = (step: string, status: string, logs: string[]) => {
      if (status === "running" || status === "diagnosing") stepTimers[step] = Date.now();
      const elapsed = stepTimers[step] ? Date.now() - stepTimers[step] : undefined;
      console.log(`${tag} ${step} → ${status}${elapsed ? ` (${elapsed}ms)` : ""}${logs[0] ? ` — ${logs[0].slice(0, 60)}` : ""}`);
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step, status, logs, elapsed });
    };

    const updateRun = (updates: Partial<PipelineRun>) => {
      const pipelines = loadPipelines();
      const p = pipelines.find(pp => pp.id === pipeline.id);
      const r = p?.runs.find(rr => rr.id === run.id);
      if (r) {
        // Attach elapsed times from step timers
        if (updates.sns && stepTimers["sns"]) (updates.sns as any).elapsed = Date.now() - stepTimers["sns"];
        if (updates.sqs && stepTimers["sqs"]) (updates.sqs as any).elapsed = Date.now() - stepTimers["sqs"];
        if (updates.target && stepTimers["target"]) (updates.target as any).elapsed = Date.now() - stepTimers["target"];
        Object.assign(r, updates);
        // Compute total
        const total = ((r.sns as any)?.elapsed || 0) + ((r.sqs as any)?.elapsed || 0) + ((r.target as any)?.elapsed || 0);
        if (total) (r as any).totalElapsed = total;
        savePipelines(pipelines);
      }
      console.log(`${tag} Run status updated → ${updates.status ?? "partial update"}`);
    };

    try {
      // --- SNS → SQS: poll queue for message arrival ---
      send("sns", "running", ["Waiting for SNS to deliver message to SQS..."]);
      send("sqs", "running", ["Polling SQS queue for incoming message..."]);

      const settings = await loadSettings();
      const pollMs = settings.pipeline.observerPollingMs;
      const sqsTimeout = pipeline.filterPolicy ? 10000 : 60000;
      console.log(`${tag} Polling SQS (interval: ${pollMs}ms, timeout: ${sqsTimeout / 1000}s, hasFilter: ${!!pipeline.filterPolicy})`);

      const sqsResult = await this.pollFor(async () => {
        try {
          const sqsClient = await getSqsClient();
          const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({
            QueueUrl: pipeline.queueUrl,
            AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages, QueueAttributeName.ApproximateNumberOfMessagesNotVisible],
          }));
          const visible = parseInt(Attributes.ApproximateNumberOfMessages ?? "0");
          const inFlight = parseInt(Attributes.ApproximateNumberOfMessagesNotVisible ?? "0");
          if (visible > 0 || inFlight > 0) {
            console.log(`${tag} SQS activity detected — visible: ${visible}, inFlight: ${inFlight}`);
            return "delivered";
          }
        } catch (e: any) { console.log(`${tag} SQS poll error: ${e.message}`); }
        return null;
      }, pollMs, sqsTimeout);

      if (!sqsResult) {
        // Before concluding filtered, check if target Lambda already ran (message consumed too fast to observe in SQS)
        let targetAlreadyRan = false;
        try {
          const cw = await getCWClient();
          const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}`, orderBy: "LastEventTime", descending: true, limit: 1 }));
          const stream = streams.logStreams?.[0];
          if (stream?.lastEventTimestamp && stream.lastEventTimestamp >= run.timestamp - 5000) { targetAlreadyRan = true; console.log(`${tag} Target Lambda already ran — message was NOT filtered, SQS was just consumed too fast`); }
        } catch {}

        if (targetAlreadyRan) {
          // Message went through — SQS was consumed before we could observe it
          console.log(`${tag} SNS → SQS → Target happened too fast to observe SQS`);
          send("sns", "success", [`Published to ${pipeline.topicName}`, `Delivered to SQS (consumed immediately)`]);
          send("sqs", "success", [`Message consumed by ${pipeline.targetFunctionName} before SQS poll`]);
          updateRun({
            sns: { status: "success", logs: ["Delivered (fast path)"] },
            sqs: { status: "success", logs: ["Consumed immediately"] },
          });
        } else if (pipeline.filterPolicy) {
          console.log(`${tag} No SQS activity + filter policy → marking as filtered`);
          send("sns", "filtered", ["SNS publish succeeded but the filter policy blocked delivery.", "", `Filter scope: ${pipeline.filterPolicyScope || "MessageAttributes"}`, `Filter policy: ${JSON.stringify(pipeline.filterPolicy)}`]);
          send("sqs", "filtered", ["No message received — filtered by SNS subscription filter policy."]);
          send("target", "filtered", ["Skipped — message was filtered by SNS."]);
          updateRun({
            sns: { status: "filtered", logs: ["Filtered by policy"] }, sqs: { status: "filtered", logs: ["No message received"] },
            target: { requestId: "", logs: ["Skipped — filtered"], error: false }, status: "filtered",
          });
          return;
        } else if (!targetAlreadyRan) {
          console.log(`${tag} SQS timeout — no message arrived in ${sqsTimeout / 1000}s`);
          send("sns", "timeout", ["Could not confirm SNS delivery within timeout."]);
          send("sqs", "timeout", ["No SQS message detected within timeout."]);
          send("target", "error", ["Skipped — previous step timed out"]);
          updateRun({
            sns: { status: "timeout", logs: ["Timeout"] }, sqs: { status: "timeout", logs: ["Timeout"] },
            target: { requestId: "", logs: ["Skipped — timed out"], error: true }, status: "error",
          });
          return;
        }
      }

      console.log(`${tag} SNS → SQS confirmed`);
      send("sns", "success", [`Published to ${pipeline.topicName}`, `Delivered to SQS queue ${pipeline.queueName}`]);
      send("sqs", "success", [`Message arrived in ${pipeline.queueName}`]);
      updateRun({
        sns: { status: "success", logs: [`Delivered to ${pipeline.queueName}`] },
        sqs: { status: "success", logs: ["Message received"] },
      });

      // --- Target Lambda: poll CloudWatch logs ---
      send("target", "running", ["Waiting for target Lambda to process message..."]);
      console.log(`${tag} Polling target Lambda logs (function: ${pipeline.targetFunctionName})`);

      const targetLogs = await this.pollFor(async () => {
        try {
          const cw = await getCWClient();
          const logGroup = `/aws/lambda/${pipeline.targetFunctionName}`;
          const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 3 }));
          for (const stream of streams.logStreams ?? []) {
            if (stream.lastEventTimestamp && stream.lastEventTimestamp < run.timestamp - 10000) continue;
            const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: stream.logStreamName!, startFromHead: false, limit: 100 }));
            const logs = (events.events || [])
              .filter(e => !e.timestamp || e.timestamp >= run.timestamp - 5000)
              .map(e => e.message?.trimEnd() || "").filter(Boolean);
            if (logs.length) {
              console.log(`${tag} Target Lambda logs found — ${logs.length} line(s) in stream ${stream.logStreamName}`);
              return logs;
            }
          }
        } catch (e: any) {
          if (!e.message?.includes("ResourceNotFoundException")) console.log(`${tag} Target log poll error: ${e.message}`);
        }
        return null;
      }, Math.max(pollMs, 2000), 60000);

      if (targetLogs) {
        const hasError = targetLogs.some(l => /\bERROR\b/.test(l) || /Exception/.test(l) || /FunctionError/.test(l));
        console.log(`${tag} Target Lambda ${hasError ? "FAILED" : "succeeded"} — ${targetLogs.length} log line(s)`);
        send("target", hasError ? "error" : "success", targetLogs);
        updateRun({ target: { requestId: "", logs: targetLogs, error: hasError }, status: hasError ? "error" : "success" });
      } else {
        console.log(`${tag} No target Lambda logs after 60s — checking Lambda state`);
        let failReason = "";
        try {
          const client = await getLambdaClient();
          const fn = await client.send(new GetFunctionCommand({ FunctionName: pipeline.targetFunctionName }));
          if (fn.Configuration?.State === "Failed") failReason = fn.Configuration?.StateReason || "Lambda is in a failed state";
          console.log(`${tag} Lambda state: ${fn.Configuration?.State}, lastUpdate: ${fn.Configuration?.LastUpdateStatus}`);
        } catch (e: any) { console.log(`${tag} Lambda state check error: ${e.message}`); }

        if (failReason) {
          console.log(`${tag} Lambda in failed state: ${failReason}`);
          send("target", "error", ["Target Lambda failed to initialize.", "", failReason, "", "Use the Deployments page for a diagnostic invoke."]);
          updateRun({ target: { requestId: "", logs: [failReason], error: true }, status: "error" });
        } else {
          // Diagnostic invoke — run the Lambda directly to extract logs
          send("target", "diagnosing", ["No CloudWatch logs found.", "", "Mouseketool is running the Lambda in the background to extract error details. This may take up to 60 seconds..."]);
          console.log(`${tag} Running diagnostic invoke for ${pipeline.targetFunctionName}`);
          const diagLogs: string[] = ["Target Lambda did not produce CloudWatch logs.", "", "Mouseketool ran the Lambda directly to extract the error:"];
          let diagHasLogs = false;
          try {
            const { InvokeCommand } = await import("@aws-sdk/client-lambda");
            const diagClient = await getLambdaClient();
            // Use captured payload from shadow queue if available
            const captured = await getCapturedPayload(pipeline.id);
            const diagPayload = captured || { Records: [{ messageId: "diag", body: "{}", eventSource: "aws:sqs" }] };
            if (captured) diagLogs.push("(Using captured SQS payload from shadow queue)", "");
            else diagLogs.push("(No captured payload available — using stub)", "");
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), 60000);
            const r = await diagClient.send(new InvokeCommand({
              FunctionName: pipeline.targetFunctionName,
              Payload: Buffer.from(JSON.stringify(diagPayload)),
              LogType: "Tail",
            }), { abortSignal: abort.signal });
            clearTimeout(timer);
            const responsePayload = r.Payload ? JSON.parse(Buffer.from(r.Payload).toString()) : null;
            if (r.FunctionError) diagLogs.push("", `FunctionError: ${r.FunctionError}`);
            diagLogs.push(...extractLogsFromPayload(responsePayload));
            if (r.LogResult) {
              const tailLogs = Buffer.from(r.LogResult, "base64").toString().split("\n").filter(Boolean);
              if (tailLogs.length) diagLogs.push("", "── Tail Logs ──", ...tailLogs);
            }
            if (responsePayload) diagLogs.push("", "── Raw Error Payload ──", JSON.stringify(responsePayload, null, 2));
            // Local class diagnostic for init errors
            if (r.FunctionError && responsePayload?.errorType?.includes("ExceptionInInitializerError")) {
              const depInfo = await getDeploymentInfo(pipeline.targetFunctionName);
              if (depInfo) {
                // Get env vars from the Lambda's current config
                let lambdaEnvVars: Record<string, string> = {};
                try {
                  const fnConfig = await (await getLambdaClient()).send(new GetFunctionCommand({ FunctionName: pipeline.targetFunctionName }));
                  lambdaEnvVars = fnConfig.Configuration?.Environment?.Variables || {};
                } catch {}
                const classDiag = await localClassDiagnose(depInfo.buildId, depInfo.handler, lambdaEnvVars);
                if (classDiag.length) diagLogs.push("", "── Local Class Diagnostic ──", ...classDiag);
              }
            }
            console.log(`${tag} Diagnostic invoke complete — ${diagLogs.length} log lines`);
            diagHasLogs = true;
          } catch (e: any) {
            diagLogs.push("", `Diagnostic invoke failed: ${e.name === "AbortError" ? "Timed out after 60s" : e.message}`);
            console.log(`${tag} Diagnostic invoke failed: ${e.message}`);
          }
          send("target", "error", diagLogs);
          updateRun({ target: { requestId: "", logs: diagLogs, error: true }, status: "error", diagAvailable: diagHasLogs } as any);
        }
      }

      // Clean up: delete the triggering message from SQS if still there
      try {
        const sqsClient = await getSqsClient();
        const recv = await sqsClient.send(new ReceiveMessageCommand({ QueueUrl: pipeline.queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 0 }));
        if (recv.Messages?.length) {
          await sqsClient.send(new DeleteMessageCommand({ QueueUrl: pipeline.queueUrl, ReceiptHandle: recv.Messages[0].ReceiptHandle! }));
          console.log(`${tag} Cleaned up SQS message`);
        }
      } catch (e: any) { console.log(`${tag} SQS cleanup skipped: ${e.message}`); }

      console.log(`${tag} Observer complete`);
    } catch (e: any) {
      console.error(`${tag} FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  }

  private pollFor<T>(checkFn: () => Promise<T | null>, intervalMs: number, timeoutMs: number): Promise<T | null> {
    return new Promise(resolve => {
      let done = false;
      const deadline = setTimeout(() => { done = true; resolve(null); }, timeoutMs);
      const id = setInterval(async () => {
        if (done) { clearInterval(id); return; }
        try {
          const result = await checkFn();
          if (result !== null) { done = true; clearTimeout(deadline); clearInterval(id); resolve(result); }
        } catch {}
      }, intervalMs);
    });
  }
}

export const watcher = new PipelineWatcher();
