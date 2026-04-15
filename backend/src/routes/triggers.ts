import { Router } from "express";
import {
  CreateEventSourceMappingCommand, ListFunctionsCommand,
  ListEventSourceMappingsCommand, DeleteEventSourceMappingCommand,
  CreateFunctionCommand, GetFunctionCommand, TagResourceCommand, ListTagsCommand,
  InvokeCommand, UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { getSqsClient } from "../helpers/sqs-client.js";
import { GetQueueAttributesCommand, QueueAttributeName } from "@aws-sdk/client-sqs";
import { formatAwsError } from "../helpers/aws-error.js";
import { PIPELINES_FILE, SETTINGS_DIR, DEPLOYMENTS_FILE, BUILDS_DIR } from "../config/constants.js";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

async function createZip(files: { name: string; content: Buffer }[], outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    for (const f of files) archive.append(f.content, { name: f.name });
    archive.finalize();
  });
}

interface Pipeline {
  id: string;
  name: string;
  sourceType: string;
  tableName: string;
  topicName: string; topicArn: string;
  queueName: string; queueUrl: string;
  glueFunctionName: string;
  targetFunctionName: string;
  uuids: string[];
  envVars: { key: string; value: string }[];
  addons: string[];
  runs: PipelineRun[];
  createdAt: string;
}

interface PipelineRun {
  id: string;
  timestamp: number;
  item?: string | null;
  handler: { requestId: string; logs: string[]; error: boolean };
  target: { requestId: string; logs: string[]; error: boolean } | null;
  status: string;
}

function loadPipelines(): Pipeline[] {
  try { return JSON.parse(readFileSync(PIPELINES_FILE, "utf-8")); } catch { return []; }
}
function savePipelines(p: Pipeline[]) {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(PIPELINES_FILE, JSON.stringify(p, null, 2));
}

import { createHash } from "crypto";

// Template Lambda definitions — hash computed from source at startup
function templateHash(sourceFile: string): string {
  const srcPath = join(__dirname, "..", "..", "src", "templates", sourceFile);
  return createHash("md5").update(readFileSync(srcPath)).digest("hex").slice(0, 8);
}

const TEMPLATES = [
  {
    id: "dynamodb-to-sns",
    name: "DynamoDB Stream → SNS Forwarder",
    description: "Reads DynamoDB stream records and publishes them to an SNS topic",
    runtime: "nodejs18.x",
    handler: "index.handler",
    sourceFile: "dynamodb-to-sns.js",
    envVars: ["SNS_TOPIC_ARN"],
    get hash() { return templateHash(this.sourceFile); },
  },
];

// GET /api/triggers/templates — list available template lambdas
router.get("/templates", (_req, res) => {
  res.json(TEMPLATES.map(t => ({ id: t.id, name: t.name, description: t.description, envVars: t.envVars, hash: t.hash })));
});

// POST /api/triggers/templates/deploy — deploy a template lambda to LocalStack
router.post("/templates/deploy", async (req, res) => {
  const { templateId, functionName, envVars = {} } = req.body;
  const template = TEMPLATES.find(t => t.id === templateId);
  if (!template) return res.status(400).json({ error: "Unknown template" });
  if (!functionName) return res.status(400).json({ error: "functionName is required" });

  try {
    const client = await getLambdaClient();

    // Check if already exists
    let existed = false;
    try {
      await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      existed = true;
    } catch {}

    if (existed) {
      // Already deployed and up to date — just return
      return res.json({ deployed: true, functionName, alreadyExisted: true });
    }

    // Build zip
    const projectRoot = join(__dirname, "..", "..");
    const srcPath = join(projectRoot, "src", "templates", template.sourceFile);
    const tmpDir = join(projectRoot, ".data", "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const zipPath = join(tmpDir, `${template.id}.zip`);

    await createZip([{ name: "index.js", content: readFileSync(srcPath) }], zipPath);
    const zipBuffer = readFileSync(zipPath);

    await client.send(new CreateFunctionCommand({
      FunctionName: functionName,
      Runtime: template.runtime as any,
      Handler: template.handler,
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Code: { ZipFile: zipBuffer },
      Environment: { Variables: envVars },
      Timeout: 30,
      Tags: { "mouseketool-template": template.id, "mouseketool-hash": template.hash },
    }));

    try { unlinkSync(zipPath); } catch {}
    res.json({ deployed: true, functionName, updated: false });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// GET /api/triggers/functions — list deployed Lambda functions from LocalStack
router.get("/functions", async (_req, res) => {
  try {
    const client = await getLambdaClient();
    const { Functions = [] } = await client.send(new ListFunctionsCommand({}));

    const fns = await Promise.all(Functions.map(async f => {
      let templateId: string | null = null;
      let outdated = false;
      try {
        const { Tags = {} } = await client.send(new ListTagsCommand({ Resource: f.FunctionArn }));
        templateId = Tags["mouseketool-template"] ?? null;
        if (templateId) {
          const tpl = TEMPLATES.find(t => t.id === templateId);
          if (tpl && Tags["mouseketool-hash"] !== tpl.hash) outdated = true;
        }
      } catch {}
      return { name: f.FunctionName, runtime: f.Runtime, handler: f.Handler, arn: f.FunctionArn, templateId, outdated };
    }));

    res.json(fns);
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/triggers/wire — full chain: DynamoDB Stream → glue Lambda, SNS→SQS subscription, SQS → target Lambda
router.post("/wire", async (req, res) => {
  const { streamArn, glueFunctionName, topicArn, queueUrl, targetFunctionName, pipelineName, addons } = req.body;
  if (!streamArn || !glueFunctionName || !topicArn || !queueUrl || !targetFunctionName)
    return res.status(400).json({ error: "streamArn, glueFunctionName, topicArn, queueUrl, and targetFunctionName are required" });

  try {
    const lambdaClient = await getLambdaClient();
    const sqsClient = await getSqsClient();
    const { getSnsClient } = await import("../helpers/sns-client.js");
    const { SubscribeCommand } = await import("@aws-sdk/client-sns");
    const snsClient = await getSnsClient();

    // Get queue ARN
    const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [QueueAttributeName.QueueArn],
    }));
    const queueArn = Attributes.QueueArn;
    if (!queueArn) return res.status(400).json({ error: "Could not resolve queue ARN" });

    const results: { step: string; detail: string }[] = [];

    // Helper: find existing mapping or create new
    async function findOrCreateMapping(eventSourceArn: string, functionName: string, startingPosition?: string) {
      const { EventSourceMappings = [] } = await lambdaClient.send(new ListEventSourceMappingsCommand({ EventSourceArn: eventSourceArn, FunctionName: functionName }));
      const existing = EventSourceMappings[0];
      if (existing) return existing.UUID!;
      const cmd: any = { EventSourceArn: eventSourceArn, FunctionName: functionName, BatchSize: 10, Enabled: true, MaximumBatchingWindowInSeconds: 5 };
      if (startingPosition) cmd.StartingPosition = startingPosition;
      const res = await lambdaClient.send(new CreateEventSourceMappingCommand(cmd));
      return res.UUID!;
    }

    // 1. DynamoDB Stream → Glue Lambda
    const streamUuid = await findOrCreateMapping(streamArn, glueFunctionName, "LATEST");
    results.push({ step: "DynamoDB Stream → Glue Lambda", detail: `UUID: ${streamUuid}` });

    // 2. SNS → SQS subscription (idempotent by default)
    const { SubscriptionArn } = await snsClient.send(new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "sqs",
      Endpoint: queueArn,
    }));
    results.push({ step: "SNS → SQS Subscription", detail: `Sub: ${SubscriptionArn}` });

    // 3. SQS → Target Lambda
    const sqsUuid = await findOrCreateMapping(queueArn, targetFunctionName);
    results.push({ step: "SQS → Target Lambda", detail: `UUID: ${sqsUuid}` });

    // Save pipeline
    const tableName = streamArn.split("/")[1] ?? streamArn;
    const pipeline: Pipeline = {
      id: crypto.randomUUID(),
      name: pipelineName || `${tableName} → ${targetFunctionName}`,
      sourceType: "dynamodb",
      tableName,
      topicName: topicArn.split(":").pop() ?? topicArn,
      topicArn, queueName: queueUrl.split("/").pop() ?? queueUrl,
      queueUrl, glueFunctionName, targetFunctionName,
      uuids: results.filter(r => r.detail.startsWith("UUID:")).map(r => r.detail.replace("UUID: ", "")),
      envVars: [],
      addons: addons ?? [],
      runs: [],
      createdAt: new Date().toISOString(),
    };

    // Pre-populate env vars from deployment config if available
    try {
      const depsRaw = readFileSync(DEPLOYMENTS_FILE, "utf-8");
      const dep = JSON.parse(depsRaw).find((d: any) => d.functionName === targetFunctionName);
      if (dep?.buildId) {
        const saved = JSON.parse(readFileSync(join(BUILDS_DIR, dep.buildId, "envvars.json"), "utf-8"));
        pipeline.envVars = saved;
      }
    } catch {}

    const pipelines = loadPipelines();
    pipelines.push(pipeline);
    savePipelines(pipelines);

    res.json({ wired: true, results, pipeline });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// GET /api/triggers/pipelines — list saved pipelines
router.get("/pipelines", (_req, res) => {
  res.json(loadPipelines());
});

// GET /api/triggers/pipelines/:id/env
router.get("/pipelines/:id/env", (req, res) => {
  const pipeline = loadPipelines().find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

  // If pipeline has env vars, return them
  if (pipeline.envVars?.length) return res.json(pipeline.envVars);

  // Fall back to deployment's envvars.json
  try {
    const deps = JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf-8"));
    const dep = deps.find((d: any) => d.functionName === pipeline.targetFunctionName);
    if (dep?.buildId) {
      const saved = JSON.parse(readFileSync(join(BUILDS_DIR, dep.buildId, "envvars.json"), "utf-8"));
      return res.json(saved);
    }
  } catch {}

  res.json([]);
});

// PUT /api/triggers/pipelines/:id/env
router.put("/pipelines/:id/env", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  pipeline.envVars = req.body.envVars ?? [];
  savePipelines(pipelines);

  // Apply to Lambda immediately so execute doesn't need to
  const entries = pipeline.envVars.filter((e: any) => e.key && !e.isNull);
  if (entries.length) {
    try {
      const client = await getLambdaClient();
      const { UpdateFunctionConfigurationCommand: Cmd } = await import("@aws-sdk/client-lambda");
      await client.send(new Cmd({
        FunctionName: pipeline.targetFunctionName,
        Environment: { Variables: Object.fromEntries(entries.map((e: any) => [e.key, e.value])) },
      }));
    } catch {}
  }

  res.json({ saved: true });
});

// DELETE /api/triggers/pipelines/:id — delete pipeline + its event source mappings
router.delete("/pipelines/:id", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

  const errors: string[] = [];

  // 1. Delete event source mappings
  try {
    const client = await getLambdaClient();
    await Promise.all(pipeline.uuids.map(uuid =>
      client.send(new DeleteEventSourceMappingCommand({ UUID: uuid })).catch(() => {})
    ));
  } catch (e: any) { errors.push(`ESM cleanup: ${e.message}`); }

  // 2. Delete stream handler Lambda (template lambda, not the target)
  try {
    const client = await getLambdaClient();
    const { DeleteFunctionCommand } = await import("@aws-sdk/client-lambda");
    await client.send(new DeleteFunctionCommand({ FunctionName: pipeline.glueFunctionName }));
  } catch (e: any) { errors.push(`Stream handler cleanup: ${e.message}`); }

  // 3. Delete SNS topic
  try {
    const { getSnsClient } = await import("../helpers/sns-client.js");
    const snsClient = await getSnsClient();
    const { DeleteTopicCommand } = await import("@aws-sdk/client-sns");
    await snsClient.send(new DeleteTopicCommand({ TopicArn: pipeline.topicArn }));
  } catch (e: any) { errors.push(`SNS cleanup: ${e.message}`); }

  // 4. Delete SQS queues (main + DLQ)
  try {
    const sqsClient = await getSqsClient();
    const { DeleteQueueCommand } = await import("@aws-sdk/client-sqs");
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: pipeline.queueUrl }));
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: pipeline.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq") })).catch(() => {});
  } catch (e: any) { errors.push(`SQS cleanup: ${e.message}`); }

  // 5. Delete CloudWatch log groups
  try {
    const cw = await getCWClient();
    const { DeleteLogGroupCommand } = await import("@aws-sdk/client-cloudwatch-logs");
    await cw.send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${pipeline.glueFunctionName}` })).catch(() => {});
    await cw.send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}` })).catch(() => {});
  } catch (e: any) { errors.push(`CloudWatch cleanup: ${e.message}`); }

  savePipelines(pipelines.filter(p => p.id !== req.params.id));
  res.json({ deleted: true, errors: errors.length ? errors : undefined });
});

import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { getDynamoClient } from "../helpers/dynamo-client.js";
import { loadSettings } from "../helpers/settings.js";

async function getCWClient() {
  const s = await loadSettings();
  return new CloudWatchLogsClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}

async function fetchLatestLogs(functionName: string, since?: number): Promise<string[]> {
  try {
    const cw = await getCWClient();
    const logGroup = `/aws/lambda/${functionName}`;
    console.log(`[logs] Fetching logs for ${logGroup}${since ? ` since=${since}` : ""}`);
    const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 1 }));
    const streamName = streams.logStreams?.[0]?.logStreamName;
    if (!streamName) { console.log(`[logs] No log streams found for ${logGroup}`); return []; }
    console.log(`[logs] Using stream: ${streamName}`);
    // Don't filter by startTime — LocalStack timestamps can be unreliable
    // Instead fetch latest events and filter client-side
    const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: streamName, startFromHead: false, limit: 50 }));
    const allLogs = (events.events || []).map(e => e.message?.trimEnd() || "").filter(Boolean);
    if (since) {
      // Filter by timestamp if available, but also accept all if timestamps are missing
      const filtered = (events.events || [])
        .filter(e => !e.timestamp || e.timestamp >= since - 5000) // 5s grace
        .map(e => e.message?.trimEnd() || "").filter(Boolean);
      console.log(`[logs] ${allLogs.length} total events, ${filtered.length} after time filter`);
      return filtered;
    }
    console.log(`[logs] ${allLogs.length} events (no time filter)`);
    return allLogs;
  } catch (err: any) {
    console.log(`[logs] Error fetching logs for ${functionName}: ${err.message}`);
    return [];
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// POST /api/triggers/pipelines/:id/execute — manual trigger: invoke each step directly
router.post("/pipelines/:id/execute", async (req, res) => {
  console.log(`[execute] Starting pipeline execution for ${req.params.id}`);
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

  const { item } = req.body;
  if (!item || typeof item !== "object") return res.status(400).json({ error: "item object is required" });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (step: string, status: string, logs?: string[]) => {
    console.log(`[execute] >> ${step}: ${status}${logs?.length ? ` (${logs.length} lines)` : ""}`);
    res.write(`data: ${JSON.stringify({ step, status, logs })}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  };

  try {
    const lambdaClient = await getLambdaClient();
    const { getSnsClient: getSns } = await import("../helpers/sns-client.js");
    const snsClient = await getSns();

    // Clean slate: purge queues and delete log groups from previous runs
    try {
      const sqsClient = await getSqsClient();
      const { PurgeQueueCommand } = await import("@aws-sdk/client-sqs");
      await sqsClient.send(new PurgeQueueCommand({ QueueUrl: pipeline.queueUrl })).catch(() => {});
      await sqsClient.send(new PurgeQueueCommand({ QueueUrl: pipeline.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq") })).catch(() => {});
      const cw = await getCWClient();
      const { DeleteLogGroupCommand } = await import("@aws-sdk/client-cloudwatch-logs");
      await cw.send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${pipeline.glueFunctionName}` })).catch(() => {});
      await cw.send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}` })).catch(() => {});
      console.log("[execute] Cleaned up previous run artifacts");
    } catch {}

    // Step 1: Insert into DynamoDB
    send("dynamodb", "running");
    const dynamoClient = await getDynamoClient();
    function toDynamoValue(v: any): any {
      if (v === null || v === undefined) return { NULL: true };
      if (typeof v === "string") return { S: v };
      if (typeof v === "number") return { N: String(v) };
      if (typeof v === "boolean") return { BOOL: v };
      if (Array.isArray(v)) return { L: v.map(toDynamoValue) };
      if (typeof v === "object") return { M: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toDynamoValue(val)])) };
      return { S: String(v) };
    }
    const dynamoItem = Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toDynamoValue(v)]));
    await dynamoClient.send(new PutItemCommand({ TableName: pipeline.tableName, Item: dynamoItem }));
    send("dynamodb", "success", ["Item inserted into " + pipeline.tableName]);

    // Sequential polling: each step waits for the previous one
    const STEP_TIMEOUT = 60000;
    let aborted = false;
    req.on("close", () => { aborted = true; });

    function pollUntil<T>(checkFn: () => Promise<T | null>, intervalMs: number, timeoutMs: number): Promise<T | null> {
      return new Promise(resolve => {
        let done = false;
        const deadline = setTimeout(() => { done = true; resolve(null); }, timeoutMs);
        const id = setInterval(async () => {
          if (done || aborted) { clearTimeout(deadline); clearInterval(id); if (aborted) resolve(null); return; }
          try {
            const result = await checkFn();
            if (result !== null) { done = true; clearTimeout(deadline); clearInterval(id); resolve(result); }
          } catch {}
        }, intervalMs);
      });
    }

    async function diagInvoke(functionName: string, payload: any): Promise<{ logs: string[]; error: boolean }> {
      const logs: string[] = [];
      let hasError = false;
      try {
        const c = await getLambdaClient();
        const r = await c.send(new InvokeCommand({ FunctionName: functionName, Payload: new TextEncoder().encode(JSON.stringify(payload)), LogType: "Tail" }));
        if (r.LogResult && !r.FunctionError) logs.push(...Buffer.from(r.LogResult, "base64").toString().split("\n").filter(Boolean));
        const p = r.Payload ? JSON.parse(Buffer.from(r.Payload).toString()) : null;
        if (r.FunctionError) {
          hasError = true;
          logs.push(`FunctionError: ${r.FunctionError}`);
          if (p?.errorMessage) logs.push(`Error: ${p.errorMessage}`);
          if (p?.errorType) logs.push(`Type: ${p.errorType}`);
          if (p?.stackTrace) logs.push(...(Array.isArray(p.stackTrace) ? p.stackTrace : [String(p.stackTrace)]));
        } else if (p) { logs.push(typeof p === "string" ? p : JSON.stringify(p, null, 2)); }
      } catch (e: any) { logs.push(`Invoke failed: ${e.message}`); hasError = true; }
      if (hasError) {
        try {
          const cfg = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
          const keys = Object.keys(cfg.Configuration?.Environment?.Variables ?? {});
          logs.push("", `Environment variables (${keys.length}): ${keys.length ? keys.join(", ") : "none"}`);
        } catch {}
      }
      return { logs, error: hasError };
    }

    const execStartTime = Date.now();

    // Step 2: Wait for stream handler logs (only accept logs after execStartTime)
    send("glue", "running", ["Waiting for DynamoDB Stream to trigger stream handler..."]);
    const glueLogs = await pollUntil(async () => {
      const cw = await getCWClient();
      const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: `/aws/lambda/${pipeline.glueFunctionName}`, orderBy: "LastEventTime", descending: true, limit: 1 }));
      const stream = streams.logStreams?.[0];
      if (!stream?.logStreamName || (stream.lastEventTimestamp && stream.lastEventTimestamp < execStartTime - 5000)) return null;
      const events = await cw.send(new GetLogEventsCommand({ logGroupName: `/aws/lambda/${pipeline.glueFunctionName}`, logStreamName: stream.logStreamName, startFromHead: false, limit: 50 }));
      const logs = (events.events || []).filter(e => !e.timestamp || e.timestamp >= execStartTime - 5000).map(e => e.message?.trimEnd() || "").filter(Boolean);
      return logs.length ? logs : null;
    }, 3000, STEP_TIMEOUT);

    let failed = false;
    if (glueLogs) {
      send("glue", "success", glueLogs);
    } else {
      const diag = await diagInvoke(pipeline.glueFunctionName, { Records: [{ eventName: "INSERT", eventSource: "aws:dynamodb", dynamodb: { NewImage: dynamoItem, Keys: dynamoItem } }] });
      if (diag.error) {
        send("glue", "error", diag.logs.length ? diag.logs : ["Stream handler failed"]);
        failed = true;
      } else {
        send("glue", "success", diag.logs.length ? diag.logs : ["Stream handler invoked successfully (via diagnostic)"]);
      }
    }

    if (failed) { send("sns", "error", ["Skipped — previous step failed"]); send("sqs", "error", ["Skipped — previous step failed"]); send("target", "error", ["Skipped — previous step failed"]); send("done", "complete"); return; }

    // Step 3: SNS — inferred from SQS arrival (no direct way to observe SNS)
    send("sns", "running", ["Waiting for SNS delivery..."]);

    // Step 4: Wait for SQS message (also check target Lambda logs as proof the message flowed through)
    send("sqs", "running", ["Waiting for message in SQS queue..."]);
    const sqsFound = await pollUntil(async () => {
      // Check queue attributes
      try {
        const sqsClient = await getSqsClient();
        const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({
          QueueUrl: pipeline.queueUrl,
          AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages, QueueAttributeName.ApproximateNumberOfMessagesNotVisible],
        }));
        const total = parseInt(Attributes.ApproximateNumberOfMessages ?? "0") + parseInt(Attributes.ApproximateNumberOfMessagesNotVisible ?? "0");
        if (total > 0) return "queue";
      } catch {}
      // If message already consumed, check if target Lambda has new logs (proves SQS delivered)
      try {
        const cw = await getCWClient();
        const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}`, orderBy: "LastEventTime", descending: true, limit: 1 }));
        const stream = streams.logStreams?.[0];
        if (stream?.lastEventTimestamp && stream.lastEventTimestamp >= execStartTime - 5000) return "consumed";
      } catch {}
      // Also check DLQ (proves message flowed through but target failed)
      try {
        const sqsClient = await getSqsClient();
        const dlqUrl = pipeline.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq");
        const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages] }));
        if (parseInt(Attributes.ApproximateNumberOfMessages ?? "0") > 0) return "dlq";
      } catch {}
      return null;
    }, 2000, STEP_TIMEOUT);

    if (sqsFound) {
    const snsLogs = [`Topic: ${pipeline.topicName}`, `TopicArn: ${pipeline.topicArn}`, `Subscriber: ${pipeline.queueName} (SQS)`, "", "SNS does not produce CloudWatch logs.", `Evidence: ${sqsFound === "queue" ? "Message found in SQS queue" : sqsFound === "consumed" ? "Target Lambda received the message" : "Message found in DLQ"}`];
    const sqsLogs = [`Queue: ${pipeline.queueName}`, `QueueUrl: ${pipeline.queueUrl}`, `RedrivePolicy: DLQ → ${pipeline.queueName}-dlq (maxReceiveCount: 3)`, "", "SQS does not produce CloudWatch logs.", `Evidence: ${sqsFound === "queue" ? "Message visible in queue" : sqsFound === "consumed" ? "ESM delivered message to target Lambda" : "Message moved to DLQ after failed processing"}`];
      send("sns", "success", snsLogs);
      send("sqs", "success", sqsLogs);
    } else {
      send("sns", "error", ["Could not confirm SNS delivery within timeout"]);
      send("sqs", "error", ["No SQS message detected within timeout"]);
      send("target", "error", ["Skipped — previous step failed"]);
      send("done", "complete"); console.log(`[execute] Pipeline execution complete (SQS timeout)`); return;
    }

    // Step 5: Wait for target Lambda logs or DLQ
    send("target", "running", ["Waiting for target Lambda to process message..."]);
    const targetResult = await pollUntil(async () => {
      // Check CloudWatch logs (only accept logs after execStartTime)
      try {
        const cw = await getCWClient();
        const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}`, orderBy: "LastEventTime", descending: true, limit: 1 }));
        const stream = streams.logStreams?.[0];
        if (stream?.logStreamName && (!stream.lastEventTimestamp || stream.lastEventTimestamp >= execStartTime - 5000)) {
          const events = await cw.send(new GetLogEventsCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}`, logStreamName: stream.logStreamName, startFromHead: false, limit: 50 }));
          const logs = (events.events || []).filter(e => !e.timestamp || e.timestamp >= execStartTime - 5000).map(e => e.message?.trimEnd() || "").filter(Boolean);
          if (logs.length) return { logs, source: "logs" };
        }
      } catch {}
      // Check DLQ
      try {
        const sqsClient = await getSqsClient();
        const dlqUrl = pipeline.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq");
        const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages] }));
        if (parseInt(Attributes.ApproximateNumberOfMessages ?? "0") > 0) return { logs: ["Message moved to DLQ — Lambda failed"], source: "dlq" };
      } catch {}
      return null;
    }, 3000, STEP_TIMEOUT);

    if (targetResult) {
      if (targetResult.source === "dlq") {
        const diag = await diagInvoke(pipeline.targetFunctionName, { Records: [{ messageId: "diag", body: "{}", eventSource: "aws:sqs" }] });
        send("target", "error", [...targetResult.logs, "", ...diag.logs]);
      } else {
        send("target", "success", targetResult.logs);
      }
    } else {
      // No logs and no DLQ — diagnostic invoke
      const diag = await diagInvoke(pipeline.targetFunctionName, { Records: [{ messageId: "diag", body: "{}", eventSource: "aws:sqs" }] });
      send("target", diag.error ? "error" : "success", diag.logs.length ? diag.logs : ["Target Lambda invoked successfully (via diagnostic)"]);
    }

    /* === DIRECT INVOCATION FALLBACK (commented out — use when event source mappings are unreliable) ===
    // Step 2: Invoke Glue Lambda directly
    const streamEvent = { Records: [{ eventName: "INSERT", eventSource: "aws:dynamodb", dynamodb: { NewImage: dynamoItem, Keys: dynamoItem, StreamViewType: "NEW_AND_OLD_IMAGES" } }] };
    const glueClient = await getLambdaClient();
    const glueResult = await glueClient.send(new InvokeCommand({ FunctionName: pipeline.glueFunctionName, Payload: new TextEncoder().encode(JSON.stringify(streamEvent)) }));
    // Step 3: Publish to SNS directly
    const { PublishCommand: Pub } = await import("@aws-sdk/client-sns");
    await snsClient.send(new Pub({ TopicArn: pipeline.topicArn, Message: JSON.stringify({ eventName: "INSERT", dynamodb: { NewImage: dynamoItem } }), Subject: "DynamoDB INSERT" }));
    // Step 5: Invoke Target Lambda directly
    const targetClient = await getLambdaClient();
    const sqsEvent = { Records: [{ messageId: "mouseketool-test-" + Date.now(), body: "", eventSource: "aws:sqs", eventSourceARN: `arn:aws:sqs:us-east-1:000000000000:${pipeline.queueName}` }] };
    await targetClient.send(new InvokeCommand({ FunctionName: pipeline.targetFunctionName, Payload: new TextEncoder().encode(JSON.stringify(sqsEvent)), LogType: "Tail" }));
    === END FALLBACK === */



    send("done", "complete");
    console.log(`[execute] Pipeline execution complete`);
  } catch (err: any) {
    console.error(`[execute] FATAL: ${err.message}\n${err.stack}`);
    send("error", "error", [formatAwsError(err)]);
  }

  res.end();
});

// GET /api/triggers/pipelines/:id/history — CloudWatch-based invocation history
router.get("/pipelines/:id/history", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  if (!pipeline.runs) pipeline.runs = [];

  const cw = await getCWClient();
  const since = parseInt(req.query.since as string) || new Date(pipeline.createdAt).getTime();
  const knownIds = new Set(pipeline.runs.map(r => r.id));

  async function getInvocations(functionName: string): Promise<{ requestId: string; timestamp: number; logs: string[]; error: boolean }[]> {
    const logGroup = `/aws/lambda/${functionName}`;
    try {
      const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 5 }));
      const invocations: Map<string, { timestamp: number; logs: string[]; error: boolean }> = new Map();
      for (const stream of streams.logStreams ?? []) {
        const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: stream.logStreamName!, startTime: since, startFromHead: true, limit: 200 }));
        let currentReqId = "";
        for (const e of events.events ?? []) {
          const msg = e.message?.trimEnd() ?? "";
          const startMatch = msg.match(/^START RequestId: ([\w-]+)/);
          if (startMatch) currentReqId = startMatch[1];
          if (currentReqId) {
            const entry = invocations.get(currentReqId) ?? { timestamp: e.timestamp ?? 0, logs: [], error: false };
            entry.logs.push(msg);
            if (/^\d{4}-\d{2}-\d{2}T.+\bERROR\b/.test(msg) || /^FunctionError:/.test(msg)) entry.error = true;
            invocations.set(currentReqId, entry);
          }
        }
      }
      return [...invocations.entries()].map(([requestId, data]) => ({ requestId, ...data }));
    } catch { return []; }
  }

  // Detect new runs from CloudWatch
  const [handlerRuns, targetRuns] = await Promise.all([
    getInvocations(pipeline.glueFunctionName),
    getInvocations(pipeline.targetFunctionName),
  ]);

  let dirty = false;
  for (const h of handlerRuns) {
    if (knownIds.has(h.requestId)) continue;
    const target = targetRuns.find(t => t.timestamp >= h.timestamp && t.timestamp - h.timestamp < 120000);
    const itemLine = h.logs.find(l => l.includes("Item:")) || h.logs.find(l => l.includes("DynamoDB Record:"));
    const item = itemLine ? itemLine.replace(/.*(?:Item|DynamoDB Record):\s*/, "") : null;
    const run: PipelineRun = {
      id: h.requestId, timestamp: h.timestamp, item,
      handler: { requestId: h.requestId, logs: h.logs, error: h.error },
      target: target ? { requestId: target.requestId, logs: target.logs, error: target.error } : null,
      status: h.error ? "error" : target?.error ? "error" : target ? "success" : "pending",
    };
    pipeline.runs.push(run);
    knownIds.add(h.requestId);
    dirty = true;
  }

  // Update pending runs that now have target data
  for (const run of pipeline.runs) {
    if (run.status !== "pending") continue;
    const target = targetRuns.find(t => t.timestamp >= run.timestamp && t.timestamp - run.timestamp < 120000);
    if (target) {
      run.target = { requestId: target.requestId, logs: target.logs, error: target.error };
      run.status = target.error ? "error" : "success";
      dirty = true;
    } else if (Date.now() - run.timestamp > 120000) {
      // Check DLQ for evidence of failure
      let dlqMsg = "Target Lambda did not respond within 2 minutes — timed out";
      try {
        const sqsClient = await getSqsClient();
        const dlqUrl = pipeline.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq");
        const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages] }));
        if (parseInt(Attributes.ApproximateNumberOfMessages ?? "0") > 0) dlqMsg = "Target Lambda failed — message moved to DLQ after max retries";
      } catch {}
      // Diagnostic: call deployments invoke to get full error details (same as Deployments page)
      const diagLogs: string[] = [dlqMsg, ""];
      try {
        const invokeRes = await fetch("http://localhost:3001/api/deployments/invoke", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ functionName: pipeline.targetFunctionName, payload: { Records: [{ messageId: "diag", body: "{}", eventSource: "aws:sqs" }] } }),
        });
        const invokeData = await invokeRes.json();
        if (invokeData.functionError) diagLogs.push(`FunctionError: ${invokeData.functionError}`);
        if (invokeData.logs?.length) diagLogs.push(...invokeData.logs);
        if (invokeData.error) diagLogs.push(invokeData.error);
      } catch (e: any) { diagLogs.push(`Diagnostic failed: ${e.message}`); }
      run.target = { requestId: "", logs: diagLogs, error: true };
      run.status = "error";
      dirty = true;
    }
  }

  if (dirty) savePipelines(pipelines);

  const sorted = [...pipeline.runs].sort((a, b) => b.timestamp - a.timestamp);
  res.json({ pipelineId: pipeline.id, pipelineName: pipeline.name, runs: sorted });
});

// GET /api/triggers/pipelines/:id/history/live — SSE for real-time run detection
router.get("/pipelines/:id/history/live", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });

  const cw = await getCWClient();
  let lastSeen = Date.now();
  let knownRequestIds = new Set<string>();

  const interval = setInterval(async () => {
    try {
      const logGroup = `/aws/lambda/${pipeline!.glueFunctionName}`;
      const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 2 }));
      for (const stream of streams.logStreams ?? []) {
        const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: stream.logStreamName!, startTime: lastSeen - 5000, startFromHead: true, limit: 100 }));
        for (const e of events.events ?? []) {
          const match = e.message?.match(/^START RequestId: ([\w-]+)/);
          if (match && !knownRequestIds.has(match[1])) {
            knownRequestIds.add(match[1]);
            lastSeen = Math.max(lastSeen, e.timestamp ?? 0);
            res.write(`data: ${JSON.stringify({ type: "new-run", requestId: match[1], timestamp: e.timestamp })}\n\n`);
            if (typeof (res as any).flush === "function") (res as any).flush();
          }
        }
      }
    } catch {} // log group may not exist yet
  }, 3000);

  // Observer: watch target Lambda, purge queues after execution completes
  let lastTargetSeen = Date.now();
  const targetInterval = setInterval(async () => {
    try {
      const targetLogGroup = `/aws/lambda/${pipeline!.targetFunctionName}`;
      const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: targetLogGroup, orderBy: "LastEventTime", descending: true, limit: 1 }));
      const stream = streams.logStreams?.[0];
      if (stream?.lastEventTimestamp && stream.lastEventTimestamp > lastTargetSeen) {
        lastTargetSeen = stream.lastEventTimestamp;
        // Target Lambda ran — purge queues to prevent re-triggers
        try {
          const sqsClient = await getSqsClient();
          const { PurgeQueueCommand } = await import("@aws-sdk/client-sqs");
          await sqsClient.send(new PurgeQueueCommand({ QueueUrl: pipeline!.queueUrl })).catch(() => {});
          await sqsClient.send(new PurgeQueueCommand({ QueueUrl: pipeline!.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq") })).catch(() => {});
        } catch {}
      }
    } catch {}
  }, 5000);

  req.on("close", () => { clearInterval(interval); clearInterval(targetInterval); });
});

export default router;
