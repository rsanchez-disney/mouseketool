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
              if (/^\d{4}-\d{2}-\d{2}T.+\bERROR\b/.test(msg)) hasError = true;
            }
          }
          if (reqId && !this.knownRequestIds.has(reqId)) this.detected(pipeline, reqId, ts, logs, hasError);
        }
      } catch {}
    }

    // S3-based detection for Queue Consumer pipelines
    for (const pipeline of pipelines) {
      if (pipeline.type !== 'queue-consumer' || !pipeline.shadow?.folder) continue;
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
            sqs: { status: 'success', logs: items ? [`Received ${Array.isArray(items) ? items.length : 1} item(s)`] : ['Message received'] },
            target: null, status: 'pending',
          };
          const pps = loadPipelines();
          const p = pps.find(pp => pp.id === pipeline.id);
          if (p) {
            // Match against pending stub by hash
            const hash = items ? this.computeHash(JSON.stringify(items)) : null;
            const stubIdx = hash ? p.runs.findIndex(r => r.source === 'manual' && r.status === 'pending' && (r as any).hash === hash) : -1;
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
          const dynamoItems = await readS3Json(dynamoItemsFiles[0]);
          if (dynamoItems) {
            run.item = JSON.stringify(dynamoItems);
            updateRun({ item: run.item });
            this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'dynamodb', status: 'success', logs: [`Inserted: ${JSON.stringify(dynamoItems).slice(0, 200)}`] });
          }
          const dynamoEventFile = dynamoItemsFiles[0].replace('/dynamo-items-', '/dynamo-event-');
          await moveToProcessed(pipeline.shadow.folder, [dynamoItemsFiles[0], dynamoEventFile]);
        }
      } catch (e: any) { console.log(`${tag} Failed to read DynamoDB captures:`, e.message); }
    }

    // --- APP Pipeline: check for SNS filter detection ---
    if (pipeline.type === 'app-pipeline' && pipeline.shadow?.folder) {
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'sns', status: 'running', logs: ['Checking SNS delivery...'] });
      // Poll S3 for sqs-event files (shadow Lambda B captures)
      const timeout = pipeline.filterPolicy ? 10000 : 30000;
      const sqsCapture = await this.pollFor(async () => {
        const { listFolderFiles, readS3Json } = await import('./shadow-infra.js');
        const files = await listFolderFiles(pipeline.shadow!.folder);
        const sqsEventFiles = files.filter(f => f.includes('/sqs-event-') && !f.includes('-processed/'));
        if (!sqsEventFiles.length) return null;
        const itemsFile = sqsEventFiles[0].replace('/sqs-event-', '/sqs-items-');
        const items = await readS3Json(itemsFile);
        return { eventFile: sqsEventFiles[0], itemsFile, items };
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
      const sqsLogs = sqsCapture.items ? [`Received: ${JSON.stringify(sqsCapture.items).slice(0, 200)}`] : ['Message delivered to queue'];
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
    }, Date.now() - pollStart < 5000 ? 500 : 1000, 10000);

    if (targetResult) {
      const status = targetResult.error ? 'error' : 'success';
      console.log(`${tag} Target Lambda ${status} (${targetResult.elapsed}ms)`);
      updateRun({ status, target: { requestId: targetResult.requestId, logs: targetResult.logs, error: targetResult.error, elapsed: targetResult.elapsed } });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'target', status, logs: targetResult.logs, elapsed: targetResult.elapsed });
      return;
    }

    // --- No logs found — run diagnostic invoke ---
    console.log(`${tag} No target logs — running diagnostic invoke`);
    this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'target', status: 'diagnosing', logs: ['No CloudWatch logs detected. Running diagnostic...'] });

    try {
      const lambdaClient = await getLambdaClient();
      const { InvokeCommand } = await import('@aws-sdk/client-lambda');

      // Try to get captured event from S3 for diagnostic payload
      let diagPayload: string | undefined;
      if (pipeline.shadow?.folder) {
        const { listFolderFiles, readS3Json } = await import('./shadow-infra.js');
        const files = await listFolderFiles(pipeline.shadow.folder + '-processed');
        // Get the most recent event file
        const eventFiles = files.filter(f => f.includes('/event-') || f.includes('/sqs-event-') || f.includes('/dynamo-event-'));
        if (eventFiles.length) {
          const captured = await readS3Json(eventFiles[eventFiles.length - 1]);
          if (captured) diagPayload = JSON.stringify(captured);
        }
      }

      // Fallback stub payload
      if (!diagPayload) {
        const td = getPipelineType(pipeline.type || 'app-pipeline');
        diagPayload = td?.triggerKind === 'dynamodb-insert'
          ? JSON.stringify({ Records: [{ eventSource: 'aws:dynamodb', dynamodb: { NewImage: {} } }] })
          : JSON.stringify({ Records: [{ body: '{}', eventSource: 'aws:sqs' }] });
      }

      const invRes = await lambdaClient.send(new InvokeCommand({
        FunctionName: pipeline.targetFunctionName,
        Payload: Buffer.from(diagPayload),
        LogType: 'Tail',
      }));

      const diagLogs: string[] = ['Diagnostic invoke result:'];
      const payload = invRes.Payload ? JSON.parse(Buffer.from(invRes.Payload).toString()) : null;
      const logResult = invRes.LogResult ? Buffer.from(invRes.LogResult, 'base64').toString() : '';
      if (invRes.FunctionError) diagLogs.push('FunctionError: ' + invRes.FunctionError);
      if (payload?.errorMessage) diagLogs.push('Error: ' + payload.errorMessage);
      if (payload?.errorType) diagLogs.push('Type: ' + payload.errorType);
      if (logResult) diagLogs.push('', ...logResult.split('\n').filter((l: string) => l.trim()));

      console.log(`${tag} Diagnostic complete — ${invRes.FunctionError ? 'error' : 'success'}`);
      updateRun({ status: 'error', target: { requestId: invRes.$metadata?.requestId || '', logs: diagLogs, error: true } });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'target', status: 'error', logs: diagLogs });
    } catch (e: any) {
      const errLogs = ['Diagnostic invoke failed: ' + e.message];
      updateRun({ status: 'error', target: { requestId: '', logs: errLogs, error: true } });
      this.stepUpdate$.next({ pipelineId: pipeline.id, runId: run.id, step: 'target', status: 'error', logs: errLogs });
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
