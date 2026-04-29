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
import { getPipelineType } from "./pipeline-types.js";
import { PIPELINES_FILE, SETTINGS_DIR } from "../config/constants.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

// --- Types ---

export interface Pipeline {
  id: string; name: string; type?: string; sourceType: string; tableName: string;
  topicName: string; topicArn: string; queueName: string; queueUrl: string;
  glueFunctionName: string; targetFunctionName: string; uuids: string[];
  subscriptionArn?: string; filterPolicy?: Record<string, unknown>; filterPolicyScope?: string;
  shadowSubscriptionArn?: string;
  topicCreatedByUs?: boolean; queueCreatedByUs?: boolean;
  vaultConfig?: { url: string; token: string; paths: string[] };
  envVars: { key: string; value: string }[]; addons: string[];
  heavyLoad?: boolean;
  runs: PipelineRun[]; createdAt: string;
}

export interface PipelineRun {
  id: string; timestamp: number; item?: string | null; items?: string[]; source: "manual" | "external";
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
  private batchState = new Map<string, { baseline: number; prevCount: number; count: number }>();

  get onNewRun(): Observable<{ pipelineId: string; run: PipelineRun }> { return this.newRun$.asObservable(); }
  get onStepUpdate(): Observable<StepUpdate> { return this.stepUpdate$.asObservable(); }
  getBatchCount(pipelineId: string): number { return this.batchState.get(pipelineId)?.count ?? 0; }

  createStubRun(pipelineId: string, item?: string) {
    const pipelines = loadPipelines();
    const p = pipelines.find(pp => pp.id === pipelineId);
    if (!p) return;
    const stubId = `manual-${Date.now()}`;
    const td = getPipelineType(p.type || "app-pipeline");
    const run: PipelineRun = {
      id: stubId, timestamp: Date.now(), item: item ?? null, source: "manual",
      handler: { requestId: stubId, logs: td?.steps.includes("stream-handler") ? ["Waiting for stream handler..."] : ["Waiting for target Lambda..."], error: false },
      ...(td?.triggerKind === "sqs-send" ? { sqs: { status: "success", logs: ["Message sent to queue"] } } : {}),
      ...(td?.triggerKind === "sns-publish" ? { sns: { status: "success", logs: ["Message published to topic"] } } : {}),
      target: null, status: "pending",
    };
    p.runs.push(run);
    savePipelines(pipelines);
    this.newRun$.next({ pipelineId, run });
    console.log(`[watcher] Created stub run ${stubId} for pipeline ${p.name}`);
  }

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
        const typeDef = getPipelineType(pipeline.type || "app-pipeline");
        const detectFunction = typeDef?.steps.includes("stream-handler") ? pipeline.glueFunctionName : pipeline.targetFunctionName;
        if (!detectFunction) continue;
        const logGroup = `/aws/lambda/${detectFunction}`;
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
    // Batch count polling for heavy load pipelines
    for (const p of pipelines) {
      if (!p.heavyLoad) continue;
      try {
        const { getDynamoClient } = await import("../helpers/dynamo-client.js");
        const { ScanCommand } = await import("@aws-sdk/client-dynamodb");
        const client = await getDynamoClient();
        const { Count = 0 } = await client.send(new ScanCommand({ TableName: p.tableName, Select: "COUNT" }));
        let state = this.batchState.get(p.id);
        if (!state) {
          const hasPending = p.runs.some(r => r.status === "pending" || r.status === "diagnosing");
          const baseline = hasPending && Count > 0 ? Count - 1 : Count;
          state = { baseline, prevCount: Count, count: hasPending ? Count - baseline : 0 };
          this.batchState.set(p.id, state); continue;
        }
        if (Count > state.prevCount) { if (!state.count) state.baseline = state.prevCount; state.count = Count - state.baseline; }
        state.prevCount = Count;
      } catch {}
    }
    } catch (e: any) { /* LocalStack unreachable — silently skip this poll cycle */ }

  }

  private detected(pipeline: Pipeline, requestId: string, timestamp: number, logs: string[], error: boolean) {
    this.knownRequestIds.add(requestId);
    this.batchState.delete(pipeline.id);
    const itemLines = logs.filter(l => l.includes("Item:")).map(l => l.replace(/.*Item:\s*/, ""));
    const item = itemLines[0] ?? null;
    const items = itemLines.length > 1 ? itemLines : undefined;
    const source = checkManualRun(pipeline.id, timestamp) ? "manual" as const : "external" as const;

    console.log(`[watcher] New run detected — pipeline: ${pipeline.name}, requestId: ${requestId.slice(0, 8)}, source: ${source}, error: ${error}`);

    // Extract handler duration from REPORT line
    const reportLine = logs.find(l => l.includes("REPORT RequestId"));
    const durationMatch = reportLine?.match(/Duration:\s*([\d.]+)\s*ms/);
    const handlerElapsed = durationMatch ? Math.round(parseFloat(durationMatch[1])) : undefined;

    const run: PipelineRun = {
      id: requestId, timestamp, item, items, source,
      handler: { requestId, logs, error, elapsed: handlerElapsed } as any,
      sns: error ? { status: "skipped", logs: ["Skipped — stream handler failed"] } : undefined,
      sqs: error ? { status: "skipped", logs: ["Skipped — stream handler failed"] } : undefined,
      target: null, status: error ? "error" : "pending",
    };

    // For non-stream-handler types, the detected logs ARE the target Lambda result
    const typeDef2 = getPipelineType(pipeline.type || "app-pipeline");
    const isDirectTarget = !typeDef2?.steps.includes("stream-handler");
    if (isDirectTarget) {
      run.target = { requestId, logs, error, elapsed: handlerElapsed } as any;
      run.handler = { requestId: "", logs: [], error: false } as any;
      run.status = error ? "error" : "success";
      run.sns = undefined; run.sqs = undefined;
    }

    const pipelines = loadPipelines();
    const p = pipelines.find(pp => pp.id === pipeline.id);
    if (p) {
      const stubIdx = source === "manual" ? p.runs.findIndex(r => r.id.startsWith("manual-") && r.status === "pending") : -1;
      if (stubIdx >= 0) { Object.assign(p.runs[stubIdx], run); }
      else { p.runs.push(run); }
      savePipelines(pipelines);
    }

    this.newRun$.next({ pipelineId: pipeline.id, run });

    if (isDirectTarget) {
      // No observer needed — detection IS the final result
      console.log(`[watcher] Direct target run ${requestId.slice(0, 8)} — ${run.status}`);
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: "target", status: run.status, logs, elapsed: handlerElapsed });
    } else if (!error) {
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
        if (updates.target && stepTimers["target"]) (updates.target as any).elapsed = Date.now() - stepTimers["target"];
        Object.assign(r, updates);
        // Compute total
        const total = ((r.handler as any)?.elapsed || 0) + ((r.target as any)?.elapsed || 0);
        if (total) (r as any).totalElapsed = total;
        savePipelines(pipelines);
      }
      console.log(`${tag} Run status updated → ${updates.status ?? "partial update"}`);
    };

    const typeDef = getPipelineType(pipeline.type || "app-pipeline");
    const typeSteps = typeDef?.steps || ["dynamodb", "stream-handler", "sns", "sqs", "lambda"];

    try {
      const settings = await loadSettings();
      const pollMs = settings.pipeline.observerPollingMs;

      // --- SNS → SQS: poll queue for message arrival (only for types with SNS/SQS) ---
      if (typeSteps.includes("sns") && typeSteps.includes("sqs") && pipeline.queueUrl) {
      send("sns", "running", ["Waiting for SNS to deliver message to SQS..."]);
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
          // Before concluding filtered, check S3 captures
          let shadowCaptured = false;
          try {
            await new Promise(r => setTimeout(r, 5000));

            const { getCapturedItems } = await import("./shadow-infra.js");
            const items = await getCapturedItems(pipeline.id);
            if (items.length) { shadowCaptured = true; console.log(`${tag} S3 captures found — NOT filtered, consumed too fast`); }
          } catch {}
          if (shadowCaptured) {
            send("sns", "success", [`Published to ${pipeline.topicName}`, `Delivered to SQS (consumed immediately)`]);
            const capturedLogs: string[] = [];
            try {
              const { getCapturedItems: getItems } = await import("./shadow-infra.js");
              const items = await getItems(pipeline.id);
              if (items.length) { capturedLogs.push(`${items.length} item${items.length > 1 ? "s" : ""} passed filter:`); items.forEach((m, i) => capturedLogs.push(`[${i + 1}] ${m}`)); }
            } catch {}
            if (!capturedLogs.length) capturedLogs.push(`Message arrived in ${pipeline.queueName}`);
            send("sqs", "success", capturedLogs);
            updateRun({ sns: { status: "success", logs: ["Delivered (fast path)"] }, sqs: { status: "success", logs: capturedLogs } });
          } else {
          console.log(`${tag} No SQS activity + filter policy → marking as filtered`);
          send("sns", "filtered", ["SNS publish succeeded but the filter policy blocked delivery.", "", `Filter scope: ${pipeline.filterPolicyScope || "MessageAttributes"}`, `Filter policy: ${JSON.stringify(pipeline.filterPolicy)}`]);
          send("sqs", "filtered", ["No message received — filtered by SNS subscription filter policy."]);
          send("target", "filtered", ["Skipped — message was filtered by SNS."]);
          updateRun({
            sns: { status: "filtered", logs: ["Filtered by policy"] }, sqs: { status: "filtered", logs: ["No message received"] },
            target: { requestId: "", logs: ["Skipped — filtered"], error: false }, status: "filtered",
          });
          return;
          }

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

      if (sqsResult) {

      console.log(`${tag} SNS → SQS confirmed`);
      send("sns", "success", [`Published to ${pipeline.topicName}`, `Delivered to SQS queue ${pipeline.queueName}`]);
      const sqsLogs = [`Message arrived in ${pipeline.queueName}`];
      send("sqs", "success", sqsLogs);
      updateRun({
        sns: { status: "success", logs: [`Delivered to ${pipeline.queueName}`] },
        sqs: { status: "success", logs: sqsLogs },
      });

      }

      } // end SNS/SQS observation

      // --- Target Lambda: poll CloudWatch logs ---
      send("target", "running", ["Waiting for target Lambda to process message..."]);
      console.log(`${tag} Polling target Lambda logs (function: ${pipeline.targetFunctionName})`);

      const targetLogs = await this.pollFor(async () => {
        try {
          const cw = await getCWClient();
          const logGroup = `/aws/lambda/${pipeline.targetFunctionName}`;
          const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 3 }));
          for (const stream of streams.logStreams ?? []) {
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
          if (!e.message?.includes("does not exist")) console.log(`${tag} Target log poll error: ${e.message}`);
        }
        return null;
      }, Math.max(pollMs, 2000), pipeline.heavyLoad ? 120000 : 60000);

      if (targetLogs) {
        const hasError = targetLogs.some(l => /\bERROR\b/.test(l) || /Exception/.test(l) || /FunctionError/.test(l));
        console.log(`${tag} Target Lambda ${hasError ? "FAILED" : "succeeded"} — ${targetLogs.length} log line(s)`);
        send("target", hasError ? "error" : "success", targetLogs);
        updateRun({ target: { requestId: "", logs: targetLogs, error: hasError }, status: hasError ? "error" : "success" });

        // Retroactively update SQS logs with captured items from S3
        try {
          await new Promise(r => setTimeout(r, 3000)); // Wait for shadow Lambda to write
          const { getCapturedItems } = await import("./shadow-infra.js");
          const sqsItems = await getCapturedItems(pipeline.id);
          if (sqsItems.length) {
            const updatedSqsLogs = [`Message arrived in ${pipeline.queueName}`, "", `${sqsItems.length} item${sqsItems.length > 1 ? "s" : ""} passed filter:`];
            sqsItems.forEach((m, i) => updatedSqsLogs.push(`[${i + 1}] ${m}`));
            send("sqs", "success", updatedSqsLogs);
            updateRun({ sqs: { status: "success", logs: updatedSqsLogs } });
          }
        } catch {}

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
              if (tailLogs.length) {
                // LogResult is limited to 4KB — try full CloudWatch logs
                let usedCW = false;
                try {
                  const cw = await getCWClient();
                  const logGroup = `/aws/lambda/${pipeline.targetFunctionName}`;
                  const strs = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 1 }));
                  const st = strs.logStreams?.[0];
                  if (st?.logStreamName) {
                    const ev = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: st.logStreamName, startFromHead: false, limit: 200 }));
                    const cwLogs = (ev.events || []).map(e => e.message?.trimEnd() || "").filter(Boolean);
                    if (cwLogs.length > tailLogs.length) { diagLogs.push("", ...cwLogs); usedCW = true; }
                  }
                } catch {}
                if (!usedCW) diagLogs.push("", ...tailLogs);
              }
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


      // Persist captured items for AI learning
      try {
        const { getCapturedItems } = await import("./shadow-infra.js");
        const { addLearnedItems } = await import("./learned-items.js");
        const learned = await getCapturedItems(pipeline.id);
        if (learned.length) await addLearnedItems(pipeline.id, learned);
      } catch {}

      // Clean up S3 captures for this pipeline
      try { const { clearCapturedItems } = await import("./shadow-infra.js"); await clearCapturedItems(pipeline.id); } catch {}

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
