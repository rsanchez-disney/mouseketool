import { Router } from "express";
import { watcher, registerManualRun, loadPipelines, savePipelines, type Pipeline, type PipelineRun } from "../services/pipeline-watcher.js";
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
    runtime: "nodejs20.x",
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

// POST /api/triggers/wire — full chain: DynamoDB Stream → Stream Handler, SNS→SQS subscription, SQS → target Lambda
router.post("/wire", async (req, res) => {
  const { streamArn, glueFunctionName, topicArn, queueUrl, targetFunctionName, pipelineName, addons, filterPolicy, filterPolicyScope, topicCreatedByUs, queueCreatedByUs, vaultConfig, heavyLoad } = req.body;
  if (!streamArn || !glueFunctionName || !topicArn || !queueUrl || !targetFunctionName)
    return res.status(400).json({ error: "streamArn, glueFunctionName, topicArn, queueUrl, and targetFunctionName are required" });

  try {
    const lambdaClient = await getLambdaClient();
    const sqsClient = await getSqsClient();
    const { getSnsClient } = await import("../helpers/sns-client.js");
    const { SubscribeCommand, SetSubscriptionAttributesCommand } = await import("@aws-sdk/client-sns");
    const snsClient = await getSnsClient();

    // Get queue ARN
    const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [QueueAttributeName.QueueArn],
    }));
    const queueArn = Attributes.QueueArn;
    if (!queueArn) return res.status(400).json({ error: "Could not resolve queue ARN" });

    const results: { step: string; detail: string }[] = [];
    const settings = await loadSettings();
    const hlBatch = settings.heavyLoad?.batchSize ?? 1000;
    const hlWindow = settings.heavyLoad?.batchWindowSeconds ?? 300;

    // Helper: find existing mapping or create new
    async function findOrCreateMapping(eventSourceArn: string, functionName: string, startingPosition?: string) {
      const { EventSourceMappings = [] } = await lambdaClient.send(new ListEventSourceMappingsCommand({ EventSourceArn: eventSourceArn, FunctionName: functionName }));
      const existing = EventSourceMappings[0];
      if (existing) return existing.UUID!;
      const cmd: any = { EventSourceArn: eventSourceArn, FunctionName: functionName, BatchSize: heavyLoad ? hlBatch : 10, Enabled: true, MaximumBatchingWindowInSeconds: heavyLoad ? hlWindow : 5 };
      if (startingPosition) cmd.StartingPosition = startingPosition;
      const res = await lambdaClient.send(new CreateEventSourceMappingCommand(cmd));
      return res.UUID!;
    }

    // 1. DynamoDB Stream → Stream Handler
    const streamUuid = await findOrCreateMapping(streamArn, glueFunctionName, "LATEST");
    results.push({ step: "DynamoDB Stream → Stream Handler", detail: `UUID: ${streamUuid}` });

    // 2. SNS → SQS subscription (idempotent by default)
    const { SubscriptionArn } = await snsClient.send(new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "sqs",
      Endpoint: queueArn,
    }));
    results.push({ step: "SNS → SQS Subscription", detail: `Sub: ${SubscriptionArn}` });

    // 2b. Apply filter policy if provided
    if (filterPolicy && SubscriptionArn) {
      await snsClient.send(new SetSubscriptionAttributesCommand({ SubscriptionArn, AttributeName: "FilterPolicy", AttributeValue: JSON.stringify(filterPolicy) }));
      if (filterPolicyScope) await snsClient.send(new SetSubscriptionAttributesCommand({ SubscriptionArn, AttributeName: "FilterPolicyScope", AttributeValue: filterPolicyScope }));
      results.push({ step: "Filter Policy", detail: `Scope: ${filterPolicyScope || "MessageAttributes"}, keys: ${Object.keys(filterPolicy).join(", ")}` });
    }

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
      subscriptionArn: SubscriptionArn ?? undefined,
      ...(filterPolicy ? { filterPolicy, filterPolicyScope: filterPolicyScope || "MessageAttributes" } : {}),
      topicCreatedByUs: !!topicCreatedByUs,
      queueCreatedByUs: !!queueCreatedByUs,
      ...(vaultConfig ? { vaultConfig } : {}),
      heavyLoad: !!heavyLoad,
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

    // Subscribe shadow queue to this pipeline's SNS topic
    try {
      const { subscribeShadowQueue } = await import("../services/shadow-infra.js");
      const shadowSubArn = await subscribeShadowQueue(topicArn, filterPolicy, filterPolicyScope);
      if (shadowSubArn) {
        const updated = loadPipelines();
        const p = updated.find(pp => pp.id === pipeline.id);
        if (p) { p.shadowSubscriptionArn = shadowSubArn; savePipelines(updated); }
      }
    } catch {}

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
// GET /api/triggers/pipelines/:id/resources — resource metadata for pipeline edit page
router.get("/pipelines/:id/resources", async (req, res) => {
  const pipeline = loadPipelines().find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  const results: Record<string, any> = {};
  try {
    const { getDynamoClient } = await import("../helpers/dynamo-client.js");
    const { DescribeTableCommand } = await import("@aws-sdk/client-dynamodb");
    const ddb = await getDynamoClient();
    const { Table } = await ddb.send(new DescribeTableCommand({ TableName: pipeline.tableName }));
    results.dynamodb = { tableName: Table!.TableName, itemCount: Table!.ItemCount ?? 0, sizeBytes: Table!.TableSizeBytes ?? 0, arn: Table!.TableArn, status: Table!.TableStatus, streamArn: Table!.LatestStreamArn, keySchema: Table!.KeySchema, attributeDefinitions: Table!.AttributeDefinitions };
  } catch { results.dynamodb = null; }
  try {
    const lambdaClient = await getLambdaClient();
    const glue = await lambdaClient.send(new GetFunctionCommand({ FunctionName: pipeline.glueFunctionName }));
    results.streamHandler = { functionName: glue.Configuration!.FunctionName, runtime: glue.Configuration!.Runtime, handler: glue.Configuration!.Handler, memorySize: glue.Configuration!.MemorySize, timeout: glue.Configuration!.Timeout, arn: glue.Configuration!.FunctionArn, lastModified: glue.Configuration!.LastModified };
  } catch { results.streamHandler = null; }
  try {
    const { getSnsClient } = await import("../helpers/sns-client.js");
    const { GetTopicAttributesCommand, ListSubscriptionsByTopicCommand } = await import("@aws-sdk/client-sns");
    const sns = await getSnsClient();
    const { Attributes = {} } = await sns.send(new GetTopicAttributesCommand({ TopicArn: pipeline.topicArn }));
    const { Subscriptions = [] } = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: pipeline.topicArn }));
    const subs = Subscriptions.filter(s => !s.Endpoint?.includes("mk-shadow-"));
    results.sns = { topicName: pipeline.topicName, arn: pipeline.topicArn, subscriptionsConfirmed: String(subs.length), subscriptionsPending: Attributes.SubscriptionsPending, subscriptions: subs.map(s => ({ endpoint: s.Endpoint, protocol: s.Protocol, subscriptionArn: s.SubscriptionArn })) };
  } catch { results.sns = null; }
  try {
    const sqsClient = await getSqsClient();
    const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: pipeline.queueUrl, AttributeNames: [QueueAttributeName.All] }));
    results.sqs = { queueName: pipeline.queueName, url: pipeline.queueUrl, arn: Attributes.QueueArn, messagesAvailable: Attributes.ApproximateNumberOfMessages, messagesInFlight: Attributes.ApproximateNumberOfMessagesNotVisible, messagesDelayed: Attributes.ApproximateNumberOfMessagesDelayed, redrivePolicy: Attributes.RedrivePolicy, visibilityTimeout: Attributes.VisibilityTimeout, createdTimestamp: Attributes.CreatedTimestamp, subscribedTopic: { name: pipeline.topicName, arn: pipeline.topicArn }, connectedTarget: { name: pipeline.targetFunctionName } };
  } catch { results.sqs = null; }
  try {
    const lambdaClient = await getLambdaClient();
    const target = await lambdaClient.send(new GetFunctionCommand({ FunctionName: pipeline.targetFunctionName }));
    results.target = { functionName: target.Configuration!.FunctionName, runtime: target.Configuration!.Runtime, handler: target.Configuration!.Handler, memorySize: target.Configuration!.MemorySize, timeout: target.Configuration!.Timeout, arn: target.Configuration!.FunctionArn, lastModified: target.Configuration!.LastModified, envVarCount: Object.keys(target.Configuration!.Environment?.Variables ?? {}).length, connectedQueue: { name: pipeline.queueName, url: pipeline.queueUrl } };
  } catch { results.target = null; }
  res.json(results);
});

// PUT /api/triggers/pipelines/:id/edit — save pipeline edits (filter policy, heavy load, add-ons)
router.put("/pipelines/:id/edit", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  const { filterPolicy, filterPolicyScope, heavyLoad, addons, vaultConfig, newTargetFunctionName } = req.body;
  try {
    // Update filter policy on SNS subscription
    if (pipeline.subscriptionArn) {
      const { getSnsClient } = await import("../helpers/sns-client.js");
      const { SetSubscriptionAttributesCommand } = await import("@aws-sdk/client-sns");
      const sns = await getSnsClient();
      if (filterPolicy && Object.keys(filterPolicy).length) {
        await sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: pipeline.subscriptionArn, AttributeName: "FilterPolicy", AttributeValue: JSON.stringify(filterPolicy) }));
        await sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: pipeline.subscriptionArn, AttributeName: "FilterPolicyScope", AttributeValue: filterPolicyScope || "MessageAttributes" }));
        pipeline.filterPolicy = filterPolicy;
        pipeline.filterPolicyScope = filterPolicyScope || "MessageAttributes";
      } else {
        await sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: pipeline.subscriptionArn, AttributeName: "FilterPolicy", AttributeValue: "{}" }));
        delete pipeline.filterPolicy;
        delete pipeline.filterPolicyScope;
      }
    }
    // Update shadow subscription filter to match
    if (pipeline.shadowSubscriptionArn) {
      const { SetSubscriptionAttributesCommand: SetSubAttr } = await import("@aws-sdk/client-sns");
      const { getSnsClient: getSns } = await import("../helpers/sns-client.js");
      const shadowSns = await getSns();
      if (filterPolicy && Object.keys(filterPolicy).length) {
        await shadowSns.send(new SetSubAttr({ SubscriptionArn: pipeline.shadowSubscriptionArn, AttributeName: "FilterPolicy", AttributeValue: JSON.stringify(filterPolicy) }));
        await shadowSns.send(new SetSubAttr({ SubscriptionArn: pipeline.shadowSubscriptionArn, AttributeName: "FilterPolicyScope", AttributeValue: filterPolicyScope || "MessageAttributes" }));
      } else {
        await shadowSns.send(new SetSubAttr({ SubscriptionArn: pipeline.shadowSubscriptionArn, AttributeName: "FilterPolicy", AttributeValue: "{}" }));
      }
    }
    // Update heavy load on ESM
    if (heavyLoad !== undefined && heavyLoad !== pipeline.heavyLoad) {
      const { UpdateEventSourceMappingCommand } = await import("@aws-sdk/client-lambda");
      const lambdaClient = await getLambdaClient();
      const s = await loadSettings();
      const uuid = pipeline.uuids[0];
      if (uuid) {
        await lambdaClient.send(new UpdateEventSourceMappingCommand({
          UUID: uuid, BatchSize: heavyLoad ? (s.heavyLoad?.batchSize ?? 1000) : 10, MaximumBatchingWindowInSeconds: heavyLoad ? (s.heavyLoad?.batchWindowSeconds ?? 300) : 5,
        }));
      }
      pipeline.heavyLoad = heavyLoad;
    }
    // Update add-ons
    pipeline.addons = addons ?? pipeline.addons;
    if (vaultConfig) { pipeline.vaultConfig = vaultConfig; (pipeline as any).vaultIncomplete = false; }
    else if (addons && !addons.includes("vault")) delete pipeline.vaultConfig;
    // Change target Lambda
    if (newTargetFunctionName && (newTargetFunctionName !== pipeline.targetFunctionName || (pipeline as any).targetMissing)) {
      // Delete old SQS → Target ESM
      try {
        const { DeleteEventSourceMappingCommand } = await import("@aws-sdk/client-lambda");
        if (pipeline.uuids[1]) await (await getLambdaClient()).send(new DeleteEventSourceMappingCommand({ UUID: pipeline.uuids[1] }));
      } catch {}
      // Create new SQS → Target ESM
      try {
        const sqsClient = await getSqsClient();
        const { Attributes = {} } = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: pipeline.queueUrl, AttributeNames: [QueueAttributeName.QueueArn] }));
        const queueArn = Attributes.QueueArn;
        if (queueArn) {
          const esm = await (await getLambdaClient()).send(new CreateEventSourceMappingCommand({ EventSourceArn: queueArn, FunctionName: newTargetFunctionName, BatchSize: 10, Enabled: true }));
          if (esm.UUID) { if (pipeline.uuids.length > 1) pipeline.uuids[1] = esm.UUID; else pipeline.uuids.push(esm.UUID); }
        }
      } catch {}
      pipeline.targetFunctionName = newTargetFunctionName;
      (pipeline as any).targetMissing = false;
      pipeline.runs = []; // Clear logs
    }

    savePipelines(pipelines);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
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

  // 3. Unsubscribe SNS → SQS (always, even if topic/queue are preserved)
  if (pipeline.subscriptionArn) {
    try {
      const { getSnsClient } = await import("../helpers/sns-client.js");
      const snsClient = await getSnsClient();
      const { UnsubscribeCommand } = await import("@aws-sdk/client-sns");
      await snsClient.send(new UnsubscribeCommand({ SubscriptionArn: pipeline.subscriptionArn }));
    } catch (e: any) { errors.push(`Unsubscribe cleanup: ${e.message}`); }
  }

  // 3b. Unsubscribe shadow queue
  if (pipeline.shadowSubscriptionArn) {
    try {
      const { unsubscribeShadowQueue } = await import("../services/shadow-infra.js");
      await unsubscribeShadowQueue(pipeline.shadowSubscriptionArn);
    } catch (e: any) { errors.push(`Shadow unsubscribe: ${e.message}`); }
  }

  // 4. Delete SNS topic
  try {
    if (pipeline.topicCreatedByUs !== false || req.query.deleteExternal === "true") {
      const { getSnsClient } = await import("../helpers/sns-client.js");
      const snsClient = await getSnsClient();
      const { DeleteTopicCommand } = await import("@aws-sdk/client-sns");
      await snsClient.send(new DeleteTopicCommand({ TopicArn: pipeline.topicArn }));
    }
  } catch (e: any) { errors.push(`SNS cleanup: ${e.message}`); }

  // 5. Delete SQS queues (main + DLQ)
  try {
    if (pipeline.queueCreatedByUs !== false || req.query.deleteExternal === "true") {
      const sqsClient = await getSqsClient();
      const { DeleteQueueCommand } = await import("@aws-sdk/client-sqs");
      await sqsClient.send(new DeleteQueueCommand({ QueueUrl: pipeline.queueUrl }));
      await sqsClient.send(new DeleteQueueCommand({ QueueUrl: pipeline.queueUrl.replace(/\/([^/]+)$/, "/$1-dlq") })).catch(() => {});
    }
  } catch (e: any) { errors.push(`SQS cleanup: ${e.message}`); }

  // 6. Delete Vault secrets
  if (pipeline.vaultConfig && req.query.deleteVault === "true") {
    try {
      const { cleanupSecrets } = await import("../helpers/vault.js");
      await cleanupSecrets(pipeline.vaultConfig.url, pipeline.vaultConfig.token, pipeline.vaultConfig.paths);
    } catch (e: any) { errors.push(`Vault cleanup: ${e.message}`); }
  }

  // 7. Delete CloudWatch log groups
  try {
    const cw = await getCWClient();
    const { DeleteLogGroupCommand } = await import("@aws-sdk/client-cloudwatch-logs");
    await cw.send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${pipeline.glueFunctionName}` })).catch(() => {});
    await cw.send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${pipeline.targetFunctionName}` })).catch(() => {});
  } catch (e: any) { errors.push(`CloudWatch cleanup: ${e.message}`); }

  savePipelines(pipelines.filter(p => p.id !== req.params.id));
  res.json({ deleted: true, errors: errors.length ? errors : undefined });
});

import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { getDynamoClient } from "../helpers/dynamo-client.js";
import { loadSettings } from "../helpers/settings.js";

async function getCWClient() {
  const s = await loadSettings();
  const { CloudWatchLogsClient } = await import("@aws-sdk/client-cloudwatch-logs");
  return new CloudWatchLogsClient({ endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`, region: s.aws.region, credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey } });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// POST /api/triggers/pipelines/:id/execute — insert item, watcher handles the rest
router.post("/pipelines/:id/execute", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

  const { item } = req.body;
  if (!item || typeof item !== "object") return res.status(400).json({ error: "item is required" });

  // SSE setup
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (step: string, status: string, logs: string[], elapsed?: number) => {
    res.write(`data: ${JSON.stringify({ step, status, logs, elapsed })}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  };

  try {
    // Step 1: Insert DynamoDB item
    send("dynamodb", "running", ["Inserting item into " + pipeline.tableName + "..."]);
    const dynamoClient = await getDynamoClient();
    function toDynamoValue(v: any): any {
      if (typeof v === "string") return { S: v };
      if (typeof v === "number") return { N: String(v) };
      if (typeof v === "boolean") return { BOOL: v };
      if (v === null) return { NULL: true };
      if (Array.isArray(v)) return { L: v.map(toDynamoValue) };
      if (typeof v === "object") return { M: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toDynamoValue(val)])) };
      return { S: String(v) };
    }
    const dynamoItem = Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toDynamoValue(v)]));
    // Add a unique timestamp to ensure DynamoDB Stream fires even on rerun with same key
    dynamoItem._mk_ts = { S: new Date().toISOString() };
    await dynamoClient.send(new PutItemCommand({ TableName: pipeline.tableName, Item: dynamoItem }));
    send("dynamodb", "success", ["Item inserted into " + pipeline.tableName]);

    registerManualRun(pipeline.id);
    watcher.createStubRun(pipeline.id, JSON.stringify(item));

    // Show waiting state for stream handler
    send("glue", "running", ["Waiting for DynamoDB Stream to trigger stream handler..."]);

    let done = false;
    req.on("close", () => { done = true; });

    // Timeout for stream handler detection — if ESM doesn't trigger within 60s, notify user
    const esmTimeout = setTimeout(() => {
      if (!done && !esmDetected) {
        send("glue", "timeout", ["DynamoDB Stream ESM did not trigger the stream handler within 60 seconds.", "", "This is a known LocalStack issue — the ESM poller may have stopped.", "Try restarting LocalStack to reset the pollers, then re-run."]);
        send("sns", "error", ["Skipped — stream handler not triggered"]);
        send("sqs", "error", ["Skipped — stream handler not triggered"]);
        send("target", "error", ["Skipped — stream handler not triggered"]);
        send("done", "complete", []);
        done = true; runSub.unsubscribe(); stepSub.unsubscribe(); res.end();
      }
    }, 60000);
    let esmDetected = false;

    const runSub = watcher.onNewRun.subscribe(event => {
      if (event.pipelineId !== pipeline.id || done) return;
      esmDetected = true; clearTimeout(esmTimeout);
      send("glue", event.run.handler.error ? "error" : "success", event.run.handler.logs, (event.run.handler as any).elapsed);
      if (event.run.handler.error) {
        send("sns", "error", ["Skipped — stream handler failed"]);
        send("sqs", "error", ["Skipped — stream handler failed"]);
        send("target", "error", ["Skipped — stream handler failed"]);
        send("done", "complete", []);
        done = true; runSub.unsubscribe(); stepSub.unsubscribe(); res.end();
      }
    });

    const stepSub = watcher.onStepUpdate.subscribe(event => {
      if (event.pipelineId !== pipeline.id || done) return;
      send(event.step, event.status, event.logs, event.elapsed);
      if (event.step === "target" && ["success", "error", "filtered", "timeout"].includes(event.status)) {
        send("done", "complete", []);
        done = true; runSub.unsubscribe(); stepSub.unsubscribe(); res.end();
      }
    });

    setTimeout(() => {
      if (!done) { done = true; runSub.unsubscribe(); stepSub.unsubscribe(); send("done", "timeout", []); res.end(); }
    }, 180000);

  } catch (err: any) {
    send("error", "error", [err.message]);
    res.end();
  }
});

// GET /api/triggers/pipelines/:id/history — return persisted runs
// GET /api/triggers/pipelines/:id/learned-items
router.get("/pipelines/:id/learned-items", async (req, res) => {
  try {
    const { getLearnedItems } = await import("../services/learned-items.js");
    res.json(await getLearnedItems(req.params.id));
  } catch { res.json([]); }
});


router.get("/pipelines/:id/history", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  const sorted = [...(pipeline.runs || [])].sort((a, b) => b.timestamp - a.timestamp);
  res.json({ pipelineId: pipeline.id, pipelineName: pipeline.name, runs: sorted });
});

// DELETE /api/triggers/pipelines/:id/history — clear all runs
router.delete("/pipelines/:id/history", (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  pipeline.runs = pipeline.runs.filter(r => r.status === "pending" || r.status === "diagnosing");
  savePipelines(pipelines);
  res.json({ cleared: true });
});

// GET /api/triggers/pipelines/:id/history/live — SSE stream for real-time updates
router.get("/pipelines/:id/history/live", async (req, res) => {
  const pipelines = loadPipelines();
  const pipeline = pipelines.find(p => p.id === req.params.id);
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });

  const runSub = watcher.onNewRun.subscribe(event => {
    if (event.pipelineId !== pipeline.id) return;
    res.write(`data: ${JSON.stringify({ type: "new-run", runId: event.run.id, source: event.run.source, timestamp: event.run.timestamp })}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  });

  const stepSub = watcher.onStepUpdate.subscribe(event => {
    if (event.pipelineId !== pipeline.id) return;
    res.write(`data: ${JSON.stringify({ type: "step-update", runId: event.runId, step: event.step, status: event.status, logs: event.logs })}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  });

  // Batch count from watcher state for heavy load pipelines
  let batchInterval: ReturnType<typeof setInterval> | null = null;
  if (pipeline.heavyLoad) {
    // Send initial batch count immediately
    const initial = watcher.getBatchCount(pipeline.id);
    if (initial > 0) {
      res.write(`data: ${JSON.stringify({ type: "batch-count", count: initial })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    }
    batchInterval = setInterval(() => {
      const count = watcher.getBatchCount(pipeline.id);
      res.write(`data: ${JSON.stringify({ type: "batch-count", count })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    }, 1500);
  }

  req.on("close", () => { runSub.unsubscribe(); stepSub.unsubscribe(); if (batchInterval) clearInterval(batchInterval); });
});

export default router;
