import { randomUUID, createHash } from "crypto";
import { Subject, Observable } from "rxjs";
import { DescribeLogStreamsCommand, GetLogEventsCommand, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { GetQueueAttributesCommand, QueueAttributeName, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { GetFunctionCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { getSqsClient } from "../helpers/sqs-client.js";
import { extractLogsFromPayload } from "../helpers/lambda-diagnostics.js";
import { localClassDiagnose, getDeploymentInfo } from "../helpers/lambda-diagnostics.js";
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
  shadow?: import("./shadow-deploy.js").ShadowMeta;
  runs: PipelineRun[]; createdAt: string;
}

export interface PipelineRun {
  id: string; timestamp: number; item?: string | null; items?: string[]; source: "manual" | "external";
  hash?: string;
  handler: { requestId: string; logs: string[]; error: boolean; elapsed?: number };
  sns?: { status: string; logs: string[]; elapsed?: number };
  sqs?: { status: string; logs: string[]; items?: any[]; elapsed?: number };
  target: { requestId: string; logs: string[]; error: boolean; elapsed?: number } | null;
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
  writeFileSync(PIPELINES_FILE, JSON.stringify(p));
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

function latestFile(files: string[]): string { return files.sort((a, b) => parseInt(a.match(/-(\d+)\.json/)?.[1] || "0") - parseInt(b.match(/-(\d+)\.json/)?.[1] || "0")).pop() || files[0]; }

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
  emitStepUpdate(update: StepUpdate) { this.stepUpdate$.next(update); }
  getBatchCount(pipelineId: string): number { return this.batchState.get(pipelineId)?.count ?? 0; }

  createStubRun(pipelineId: string, item?: string, hash?: string) {
    const pipelines = loadPipelines();
    const p = pipelines.find(pp => pp.id === pipelineId);
    if (!p) return;
    const stubId = randomUUID();
    const td = getPipelineType(p.type || "app-pipeline");
    const run: PipelineRun = {
      id: stubId, timestamp: Date.now(), item: item ?? null, hash: hash || undefined, source: "manual",
      handler: { requestId: stubId, logs: td?.steps.includes("stream-handler") ? ["Waiting for stream handler..."] : ["Waiting for target Lambda..."], error: false },
      ...(td?.triggerKind === "sqs-send" ? { sqs: { status: "success", logs: ["Message sent to queue"] } } : {}),
      ...(td?.triggerKind === "sns-publish" ? { sns: { status: "success", logs: ["Message published to topic"] } } : {}),
      ...(td?.triggerKind === "sns-publish" && td?.steps.includes("sqs") ? { sqs: { status: "success", logs: ["Delivered to queue"] } } : {}),
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
              if (/^\d{4}-\d{2}-\d{2}T.+\bERROR\b/.test(msg) || /"Level"\s*:\s*"ERROR"/.test(msg) || /\bFunctionError\b/.test(msg)) hasError = true;
            }
          }
          if (reqId && !this.knownRequestIds.has(reqId)) this.detected(pipeline, reqId, ts, logs, hasError);
        }
      } catch {}
    }

    // S3-based detection for Queue Consumer pipelines
    for (const pipeline of pipelines) {
      if ((pipeline.type !== 'queue-consumer' && pipeline.type !== 'direct-stream') || !pipeline.shadow?.folder) continue;
      try {
        const { listFolderFiles, readS3Json, moveToProcessed } = await import('./shadow-infra.js');
        const files = await listFolderFiles(pipeline.shadow.folder);
        const eventFiles = files.filter(f => f.includes('/event-') && !f.includes('-processed/'));
        for (const eventFile of eventFiles) {
          // Each event file = one execution. Spawn observer.
          const itemsFile = eventFile.replace('/event-', '/items-');
          const items = await readS3Json(itemsFile);
          const source = checkManualRun(pipeline.id, Date.now()) ? 'manual' as const : 'external' as const;
          const run: PipelineRun = {
            id: randomUUID(), timestamp: Date.now(), item: items ? JSON.stringify(items) : null, source,
            handler: { requestId: '', logs: [], error: false },
            ...(pipeline.type === 'queue-consumer' ? { sqs: { status: 'success', logs: items ? [`Received ${Array.isArray(items) ? items.length : 1} item(s)`, '', JSON.stringify(items)] : ['Message received'] } } : {}),
            target: null, status: 'pending',
          };
          const pps = loadPipelines();
          const p = pps.find(pp => pp.id === pipeline.id);
          if (p) {
            // Match against pending stub (most recent manual pending run)
            const stubIdx = p.runs.findIndex(r => r.source === 'manual' && r.status === 'pending');
            if (stubIdx >= 0) { Object.assign(p.runs[stubIdx], run); run.id = p.runs[stubIdx].id; }
            else { p.runs.push(run); }
            savePipelines(pps);
          }
          this.newRun$.next({ pipelineId: pipeline.id, run });
          // Move files to processed
          await moveToProcessed(pipeline.shadow.folder, [eventFile, itemsFile]);
          // Spawn observer for target Lambda
          this.spawnObserver(pipeline, run);
        }
      } catch (e: any) { if (this.pollCount % 15 === 0) console.log(`[watcher] S3 poll error for ${pipeline.name}:`, e.message); }
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


    // History retention cleanup (every 60s)
    if (this.pollCount % 30 === 0) {
      try {
        const settings = await loadSettings();
        const { mode, maxRuns, maxDays } = settings.historyRetention || { mode: "age", maxRuns: 50, maxDays: 2 };
        let changed = false;
        for (const p of pipelines) {
          if (!p.runs.length) continue;
          const before = p.runs.length;
          if (mode === "amount" && p.runs.length > maxRuns) {
            p.runs.sort((a, b) => b.timestamp - a.timestamp);
            p.runs.splice(maxRuns);
          } else if (mode === "age") {
            const cutoff = Date.now() - maxDays * 86400000;
            p.runs = p.runs.filter(r => r.timestamp > cutoff);
          }
          if (p.runs.length !== before) changed = true;
        }
        if (changed) savePipelines(pipelines);
      } catch {}
    }
    } catch (e: any) { /* LocalStack unreachable — silently skip this poll cycle */ }

  }

  private detected(pipeline: Pipeline, requestId: string, timestamp: number, logs: string[], error: boolean) {
    this.knownRequestIds.add(requestId);
    this.batchState.delete(pipeline.id);
    // Dedup: for direct-stream/queue-consumer, skip if a run was created in the last 30s (S3 polling already handled it)
    if (pipeline.type === 'direct-stream' || pipeline.type === 'queue-consumer') {
      const pps = loadPipelines();
      const pp = pps.find(x => x.id === pipeline.id);
      if (pp?.runs.some(r => Date.now() - r.timestamp < 30000)) return;
    }
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
      id: randomUUID(), timestamp, item, items, source,
      handler: { requestId, logs, error, elapsed: handlerElapsed },
      sns: error ? { status: "skipped", logs: ["Skipped — stream handler failed"] } : undefined,
      sqs: error ? { status: "skipped", logs: ["Skipped — stream handler failed"] } : undefined,
      target: null, status: error ? "error" : "pending",
    };

    // For non-stream-handler types, the detected logs ARE the target Lambda result
    const typeDef2 = getPipelineType(pipeline.type || "app-pipeline");
    const isDirectTarget = !typeDef2?.steps.includes("stream-handler") && !typeDef2?.steps.includes("sns");
    if (isDirectTarget) {
      run.target = { requestId, logs, error, elapsed: handlerElapsed };
      run.handler = { requestId: "", logs: [], error: false };
      run.status = error ? "error" : "success";
      // If the target was invoked, intermediate steps must have succeeded
      run.sns = typeDef2?.steps.includes("sns") ? { status: "success", logs: ["Delivered (inferred from target invocation)"] } : undefined;
      run.sqs = typeDef2?.steps.includes("sqs") ? { status: "success", logs: ["Delivered (inferred from target invocation)"] } : undefined;
    }

    const pipelines = loadPipelines();
    const p = pipelines.find(pp => pp.id === pipeline.id);
    if (p) {
      const stubIdx = source === "manual" ? p.runs.findIndex(r => r.source === "manual" && r.status === "pending") : -1;
      if (stubIdx >= 0) { Object.assign(p.runs[stubIdx], run); }
      else { if (!p.runs.some(r => Math.abs(r.timestamp - run.timestamp) < 3000 && r.status === run.status)) p.runs.push(run); }
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

  private computeHash(data: string): string {
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private async spawnObserver(pipeline: Pipeline, run: PipelineRun) {
    const tag = `[observer:${run.id.slice(0, 8)}]`;
    const typeDef = getPipelineType(pipeline.type || 'app-pipeline');
    console.log(`${tag} Started for pipeline "${pipeline.name}" (target: ${pipeline.targetFunctionName})`);

    const updateRun = (updates: Partial<PipelineRun>) => {
      const pps = loadPipelines();
      const p = pps.find(pp => pp.id === pipeline.id);
      if (!p) return;
      const r = p.runs.find(rr => rr.id === run.id);
      if (r) Object.assign(r, updates);
      savePipelines(pps);
    };

    // For APP Pipeline: read DynamoDB items from shadow Lambda A captures
    if (pipeline.type === 'app-pipeline' && pipeline.shadow?.folder) {
      try {
        const { listFolderFiles, readS3Json, moveToProcessed } = await import('./shadow-infra.js');
        const files = await listFolderFiles(pipeline.shadow.folder);
        const dynamoItemsFiles = files.filter(f => f.includes('/dynamo-items-') && !f.includes('-processed/'));
        if (dynamoItemsFiles.length) {
          const dynamoItems = await readS3Json(latestFile(dynamoItemsFiles));
          if (dynamoItems) {
            run.item = JSON.stringify(dynamoItems);
            updateRun({ item: run.item });
            this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'dynamodb', status: 'success', logs: ['Inserted:', '', JSON.stringify(Array.isArray(dynamoItems) ? dynamoItems.map((i: any) => { const { _mk_ts, ...rest } = i; return rest; }) : dynamoItems, null, 2)] });
          }
          const dynamoEventFile = latestFile(dynamoItemsFiles).replace('/dynamo-items-', '/dynamo-event-');
          await moveToProcessed(pipeline.shadow.folder, [latestFile(dynamoItemsFiles), dynamoEventFile]);
        }
      } catch (e: any) { console.log(`${tag} Failed to read DynamoDB captures:`, e.message); }
    }

    // --- APP Pipeline: check for SNS filter detection ---
    if (pipeline.type === 'app-pipeline' && pipeline.shadow?.folder) {
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'sns', status: 'running', logs: ['Checking SNS delivery...'] });
      // Poll S3 for sqs-event files (shadow Lambda B captures)
      const timeout = pipeline.heavyLoad ? 120000 : pipeline.filterPolicy ? 15000 : 30000;
      const sqsCapture = await this.pollFor(async () => {
        const { listFolderFiles, readS3Json } = await import('./shadow-infra.js');
        const files = await listFolderFiles(pipeline.shadow!.folder);
        const sqsEventFiles = files.filter(f => f.includes('/sqs-event-') && !f.includes('-processed/')).filter(f => { const ts = parseInt(f.match(/-(\d+)\.json/)?.[1] || '0'); return ts > run.timestamp - 5000; });
        if (!sqsEventFiles.length) return null;
        const itemsFile = latestFile(sqsEventFiles).replace('/sqs-event-', '/sqs-items-');
        const items = await readS3Json(itemsFile);
        return { eventFile: latestFile(sqsEventFiles), itemsFile, items };
      }, 2000, timeout);

      if (!sqsCapture) {
        // No SQS delivery detected — message was filtered by SNS
        console.log(`${tag} SNS filtered — no SQS delivery within ${timeout}ms`);
        updateRun({ status: 'filtered', sns: { status: 'filtered', logs: ['Message filtered by SNS subscription filter policy'] }, sqs: { status: 'filtered', logs: ['No message received'] }, target: { requestId: '', logs: ['Skipped — message was filtered'], error: false } });
        this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'sns', status: 'filtered', logs: ['Filtered by SNS subscription filter policy'] });
        this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'sqs', status: 'filtered', logs: ['No message received'] });
        this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'target', status: 'filtered', logs: ['Skipped'] });
        return;
      }

      // SNS delivered to SQS
      const sqsLogs = sqsCapture.items ? ['Received:', '', JSON.stringify(sqsCapture.items), ...(pipeline.heavyLoad ? ['', '⚠ Under heavy load, some captures may be missed due to LocalStack ESM polling limitations.'] : [])] : ['Message delivered to queue'];
      updateRun({ sns: { status: 'success', logs: ['Items passed to SQS queue'] }, sqs: { status: 'success', logs: sqsLogs } });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'sns', status: 'success', logs: ['Items passed to SQS queue'] });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'sqs', status: 'success', logs: sqsLogs });
      // Move processed files
      try {
        const { moveToProcessed } = await import('./shadow-infra.js');
        await moveToProcessed(pipeline.shadow.folder, [sqsCapture.eventFile, sqsCapture.itemsFile]);
      } catch {}
    }

    // --- Poll target Lambda CloudWatch logs ---
    this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'target', status: 'running', logs: ['Waiting for target Lambda...'] });
    console.log(`${tag} Polling target Lambda: ${pipeline.targetFunctionName}`);

    const cw = await getCWClient();
    const logGroup = `/aws/lambda/${pipeline.targetFunctionName}`;
    const pollStart = Date.now();

    const targetResult = await this.pollFor(async () => {
      try {
        const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: 'LastEventTime', descending: true, limit: 2 }));
        for (const stream of streams.logStreams ?? []) {
          const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: stream.logStreamName!, startTime: run.timestamp - 5000, startFromHead: true, limit: 100 }));
          const logs: string[] = [];
          let foundStart = false;
          for (const e of events.events ?? []) {
            const msg = e.message?.trimEnd() ?? '';
            if (msg.includes('START RequestId:')) foundStart = true;
            if (foundStart) logs.push(msg);
          }
          if (foundStart && logs.length > 1) {
            console.log(`${tag} CW logs found: ${logs.length} lines, hasERROR: ${logs.some(l => /ERROR/.test(l))}, sample: ${logs[1]?.slice(0, 80)}`);
            const hasError = logs.some(l => /ERROR|Exception|FunctionError/.test(l));
            const reportLine = logs.find(l => l.includes('REPORT RequestId'));
            const durationMatch = reportLine?.match(/Duration:\s*([\d.]+)\s*ms/);
            const elapsed = durationMatch ? Math.round(parseFloat(durationMatch[1])) : undefined;
            const reqMatch = logs[0]?.match(/START RequestId: ([\w-]+)/);
            return { logs, error: hasError, elapsed, requestId: reqMatch?.[1] || '' };
          }
        }
      } catch {}
      return null;
    }, Date.now() - pollStart < 5000 ? 500 : 1000, 30000);

    if (targetResult) {
      const status = targetResult.error ? "error" : "success";
      let finalLogs = targetResult.logs;
      // Enrich error logs with diagnostics (same as Deployments page)
      if (targetResult.error) {
        try {
          const lambdaClient = await getLambdaClient();
          const fnConfig = await lambdaClient.send(new GetFunctionCommand({ FunctionName: pipeline.targetFunctionName }));
          const envVars = fnConfig.Configuration?.Environment?.Variables || {};
          const { diagnoseError, extractLogsFromPayload } = await import("../helpers/lambda-diagnostics.js");
          const hints = diagnoseError(null, envVars);
          if (hints.length) finalLogs = [...finalLogs, "", "── Diagnostics ──", ...hints];
        } catch {}
      }
      console.log(`${tag} Target Lambda ${status} (${targetResult.elapsed}ms)`);
      updateRun({ status, target: { requestId: targetResult.requestId, logs: finalLogs, error: targetResult.error, elapsed: targetResult.elapsed } as any });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: "target", status, logs: finalLogs, elapsed: targetResult.elapsed });
      return;
    }

    // --- No logs found — run diagnostic invoke ---
    console.log(`${tag} No target logs — running diagnostic invoke`);
    // Don't emit diagnosing to UI to avoid flash — just log internally
    console.log(`${tag} Running diagnostic invoke...`);

    try {
      const { invokeFunction } = await import("../routes/deployments.js");
      const lambdaClient = await getLambdaClient();

      // Kill warm container to force cold start with full init logs
      try { const { execSync } = await import("child_process"); const dk = process.platform === "win32" ? "wsl docker" : "docker"; const ids = execSync(`${dk} ps --filter "name=lambda-${pipeline.targetFunctionName}" -q`, { encoding: "utf-8" }).trim(); if (ids) execSync(`${dk} rm -f ${ids.split("\n").join(" ")}`, { encoding: "utf-8" }); } catch {}

      // Use the same invoke logic as the Deployments page
      let diagPayload: any = {};
      if (pipeline.shadow?.folder) {
        const { listFolderFiles, readS3Json } = await import("./shadow-infra.js");
        const files = await listFolderFiles(pipeline.shadow.folder + "-processed");
        const eventFiles = files.filter(f => f.includes("/event-") || f.includes("/sqs-event-") || f.includes("/dynamo-event-"));
        if (eventFiles.length) { const captured = await readS3Json(latestFile(eventFiles)); if (captured) diagPayload = captured; }
      }

      const depInfo = await getDeploymentInfo(pipeline.targetFunctionName);
      const result = await invokeFunction(lambdaClient, pipeline.targetFunctionName, diagPayload, depInfo?.buildId, depInfo?.handler);
      const diagLogs = result.logs.length ? result.logs : ["Diagnostic invoke returned no logs"];

      const hasLogErrors = diagLogs.some(l => /ERROR|Exception|FunctionError/.test(l) || /"Level"\s*:\s*"ERROR"/.test(l));
      const diagStatus = (result.functionError || hasLogErrors) ? "error" : "success";
      console.log(`${tag} Diagnostic complete — ${diagStatus}`);
      updateRun({ status: diagStatus, target: { requestId: "", logs: diagLogs, error: diagStatus === "error" } as any });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: "target", status: diagStatus, logs: diagLogs });
    } catch (e: any) {
      const errLogs = ["Diagnostic invoke failed: " + e.message];
      updateRun({ status: "error", target: { requestId: "", logs: errLogs, error: true } as any });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: "target", status: "error", logs: errLogs });
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
