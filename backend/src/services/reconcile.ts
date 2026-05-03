import { readFileSync, mkdirSync, createWriteStream, existsSync } from "fs";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
import { loadPipelines, savePipelines, type Pipeline } from "./pipeline-watcher.js";
import { loadSettings } from "../helpers/settings.js";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { getDynamoClient } from "../helpers/dynamo-client.js";
import { getSqsClient } from "../helpers/sqs-client.js";
import { getSnsClient } from "../helpers/sns-client.js";
import { BUILDS_DIR, DEPLOYMENTS_FILE, SCHEMAS_DIR } from "../config/constants.js";
import {
  GetFunctionCommand, CreateFunctionCommand, CreateEventSourceMappingCommand,
  ListEventSourceMappingsCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { DescribeTableCommand, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { CreateQueueCommand, GetQueueUrlCommand, GetQueueAttributesCommand, SetQueueAttributesCommand, QueueAttributeName } from "@aws-sdk/client-sqs";
import { CreateTopicCommand, SubscribeCommand, SetSubscriptionAttributesCommand } from "@aws-sdk/client-sns";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

export interface ReconcileResult {
  pipelineId: string;
  pipelineName: string;
  actions: string[];
  warnings: string[];
  targetMissing: boolean;
}

export async function reconcilePipelines(): Promise<ReconcileResult[]> {
  const pipelines = loadPipelines();
  if (!pipelines.length) return [];
  console.log(`[reconcile] Starting reconciliation for ${pipelines.length} pipeline(s)`);
  const results: ReconcileResult[] = [];

  for (const p of pipelines) {
    // Reconcile all pipeline types
    const r: ReconcileResult = { pipelineId: p.id, pipelineName: p.name, actions: [], warnings: [], targetMissing: false };
    try {
      await reconcileOne(p, r);
    } catch (e: any) {
      r.warnings.push(`Fatal: ${e.message}`);
    }
    if (r.actions.length || r.warnings.length) results.push(r);
  }

  // Shadow infrastructure reconciliation for ALL pipeline types
  const allPipelines = loadPipelines();
  for (const p of allPipelines) {
    if (!p.type || !p.shadow) continue;
    try {
      const { reconcileShadow } = await import("./shadow-deploy.js");
      const updated = await reconcileShadow(p);
      if (updated) {
        const pps = loadPipelines();
        const pp = pps.find(x => x.id === p.id);
        if (pp) { pp.shadow = updated; savePipelines(pps); }
        console.log(`[reconcile] Shadow infra restored for "${p.name}"`);
      }
    } catch (e: any) { console.error(`[reconcile] Shadow reconcile failed for "${p.name}":`, e.message); }
  }

  savePipelines(pipelines);
  console.log(`[reconcile] Done — ${results.length} pipeline(s) needed changes`);
  return results;
}

async function reconcileOne(p: Pipeline, r: ReconcileResult) {
  const settings = await loadSettings();
  const lambda = await getLambdaClient();
  const ddb = await getDynamoClient();
  const sqs = await getSqsClient();
  const sns = await getSnsClient();

  // 1. DynamoDB table
  let streamArn = "";
  if (p.tableName) {
  try {
    const { Table } = await ddb.send(new DescribeTableCommand({ TableName: p.tableName }));
    streamArn = Table?.LatestStreamArn || "";
  } catch {
    // Try to restore from saved schema
    const schemaPath = join(SCHEMAS_DIR, `${p.tableName}.json`);
    if (existsSync(schemaPath)) {
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      const params: any = {
        TableName: schema.tableName,
        KeySchema: schema.keySchema,
        AttributeDefinitions: schema.attributeDefinitions,
        BillingMode: "PAY_PER_REQUEST",
      };
      if (schema.streamEnabled) {
        params.StreamSpecification = { StreamEnabled: true, StreamViewType: schema.streamViewType || "NEW_AND_OLD_IMAGES" };
      }
      if (schema.globalSecondaryIndexes?.length) {
        params.GlobalSecondaryIndexes = schema.globalSecondaryIndexes.map((g: any) => ({ ...g, ProvisionedThroughput: undefined }));
      }
      await ddb.send(new CreateTableCommand(params));
      const { Table } = await ddb.send(new DescribeTableCommand({ TableName: p.tableName }));
      streamArn = Table?.LatestStreamArn || "";
      r.actions.push(`Restored table ${p.tableName} from saved schema`);
    } else {
      r.warnings.push(`Table ${p.tableName} recreated with generic schema (pk/sk) — no saved schema found`);
      await ddb.send(new CreateTableCommand({
        TableName: p.tableName,
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
        AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
        BillingMode: "PAY_PER_REQUEST",
        StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_AND_OLD_IMAGES" },
      }));
      const { Table } = await ddb.send(new DescribeTableCommand({ TableName: p.tableName }));
      streamArn = Table?.LatestStreamArn || "";
    }
  }

  }
  // 2. SNS topic
  if (p.topicName) try {
    const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: p.topicName }));
    if (TopicArn && TopicArn !== p.topicArn) { p.topicArn = TopicArn; r.actions.push(`Recreated SNS topic ${p.topicName}`); }
  } catch (e: any) { r.warnings.push(`SNS topic: ${e.message}`); }

  // 3. SQS queue + DLQ
  let queueArn = "";
  if (!p.queueName) { /* No SQS for this pipeline type */ } else {
  const dlqName = p.queueName + "-dlq";
  queueArn = "";
  try {
    // Create DLQ first
    await sqs.send(new CreateQueueCommand({ QueueName: dlqName }));
    const dlqUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: dlqName }))).QueueUrl!;
    const dlqAttrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: [QueueAttributeName.QueueArn] }));
    const dlqArn = dlqAttrs.Attributes?.QueueArn || "";

    // Create main queue
    await sqs.send(new CreateQueueCommand({ QueueName: p.queueName }));
    const mainUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: p.queueName }))).QueueUrl!;
    if (mainUrl !== p.queueUrl) { p.queueUrl = mainUrl; r.actions.push(`Recreated SQS queue ${p.queueName}`); }

    // Set redrive policy
    if (dlqArn) {
      await sqs.send(new SetQueueAttributesCommand({
        QueueUrl: mainUrl,
        Attributes: { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: "3" }) },
      }));
    }

    const mainAttrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: mainUrl, AttributeNames: [QueueAttributeName.QueueArn] }));
    queueArn = mainAttrs.Attributes?.QueueArn || "";
  } catch (e: any) { r.warnings.push(`SQS queue: ${e.message}`); }

  }
  // 4. Stream handler Lambda (template)
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: p.glueFunctionName }));
  } catch {
    try {
      const srcPath = join(__dirname, "..", "..", "src", "templates", "dynamodb-to-sns.js");
      const tmpDir = join(__dirname, "..", "..", ".data", "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const zipPath = join(tmpDir, `reconcile-${p.id}.zip`);
      await createZip([{ name: "index.js", content: readFileSync(srcPath) }], zipPath);
      const zipBuffer = readFileSync(zipPath);
      const envVars: Record<string, string> = { SNS_TOPIC_ARN: p.topicArn };
      // Carry over inserts-only setting
      const glueEnvs = p.envVars?.filter((e: any) => e.key === "STREAM_INSERTS_ONLY") || [];
      for (const e of glueEnvs) envVars[e.key] = e.value;

      await lambda.send(new CreateFunctionCommand({
        FunctionName: p.glueFunctionName, Runtime: "nodejs20.x", Handler: "index.handler",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Code: { ZipFile: zipBuffer }, Environment: { Variables: envVars }, Timeout: 30,
      }));
      try { const { unlinkSync } = await import("fs"); unlinkSync(zipPath); } catch {}
      r.actions.push(`Recreated stream handler ${p.glueFunctionName}`);
    } catch (e: any) { r.warnings.push(`Stream handler: ${e.message}`); }
  }

  // 5. Target Lambda — redeploy from cached build
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: p.targetFunctionName }));
  } catch {
    const redeployed = await redeployLambda(p.targetFunctionName);
    if (redeployed) {
      r.actions.push(`Redeployed target Lambda ${p.targetFunctionName} from cached build`);
    } else {
      r.targetMissing = true;
      r.warnings.push(`Target Lambda ${p.targetFunctionName} missing and no cached build found`);
    }
  }

  // 6. Event source mappings
  // DynamoDB Stream → Stream Handler
  if (streamArn) {
    try {
      const { EventSourceMappings = [] } = await lambda.send(new ListEventSourceMappingsCommand({ EventSourceArn: streamArn, FunctionName: p.glueFunctionName }));
      if (!EventSourceMappings.length) {
        const hlBatch = settings.heavyLoad?.batchSize ?? 1000;
        const hlWindow = settings.heavyLoad?.batchWindowSeconds ?? 300;
        const esm = await lambda.send(new CreateEventSourceMappingCommand({
          EventSourceArn: streamArn, FunctionName: p.glueFunctionName,
          BatchSize: p.heavyLoad ? hlBatch : 10, MaximumBatchingWindowInSeconds: p.heavyLoad ? hlWindow : 5,
          StartingPosition: "LATEST", Enabled: true,
        }));
        if (esm.UUID) { p.uuids[0] = esm.UUID; r.actions.push("Recreated DynamoDB Stream → Stream Handler ESM"); }
      }
    } catch (e: any) { r.warnings.push(`Stream ESM: ${e.message}`); }
  }

  // SQS → Target Lambda (skip for queue-consumer — target uses relay queue)
  if (queueArn && !r.targetMissing && p.type !== "queue-consumer") {
    try {
      const { EventSourceMappings = [] } = await lambda.send(new ListEventSourceMappingsCommand({ EventSourceArn: queueArn, FunctionName: p.targetFunctionName }));
      if (!EventSourceMappings.length) {
        const esm = await lambda.send(new CreateEventSourceMappingCommand({
          EventSourceArn: queueArn, FunctionName: p.targetFunctionName,
          BatchSize: 10, Enabled: true,
        }));
        if (esm.UUID) { if (p.uuids.length > 1) p.uuids[1] = esm.UUID; else p.uuids.push(esm.UUID); r.actions.push("Recreated SQS → Target Lambda ESM"); }
      }
    } catch (e: any) { r.warnings.push(`SQS ESM: ${e.message}`); }
  }

  // 7. SNS → SQS subscription
  if (queueArn) {
    try {
      const { SubscriptionArn } = await sns.send(new SubscribeCommand({ TopicArn: p.topicArn, Protocol: "sqs", Endpoint: queueArn }));
      if (SubscriptionArn && SubscriptionArn !== p.subscriptionArn) {
        p.subscriptionArn = SubscriptionArn;
        r.actions.push("Recreated SNS → SQS subscription");
      }
      // Reapply filter policy
      if (p.filterPolicy && Object.keys(p.filterPolicy).length && p.subscriptionArn) {
        await sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: p.subscriptionArn, AttributeName: "FilterPolicy", AttributeValue: JSON.stringify(p.filterPolicy) }));
        if (p.filterPolicyScope) {
          await sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: p.subscriptionArn, AttributeName: "FilterPolicyScope", AttributeValue: p.filterPolicyScope }));
        }
      }
    } catch (e: any) { r.warnings.push(`SNS subscription: ${e.message}`); }
  }

  // 8. Shadow infrastructure subscription
  // Shadow infra reconciliation handled by reconcileShadow() in shadow-deploy.ts

  // Mark target missing on pipeline for UI
  (p as any).targetMissing = r.targetMissing;

  // Check vault secrets still exist after reconciliation
  if (p.vaultConfig && p.vaultConfig.paths?.length && r.actions.length) {
    try {
      const missing: string[] = [];
      for (const path of p.vaultConfig.paths) {
        const vr = await fetch(`${p.vaultConfig.url}/v1/secret/data/${path}`, { headers: { "X-Vault-Token": p.vaultConfig.token } });
        if (!vr.ok) missing.push(path);
      }
      if (missing.length) {
        (p as any).vaultIncomplete = true;
        r.warnings.push(`Vault secrets missing: ${missing.join(", ")}`);
      } else {
        (p as any).vaultIncomplete = false;
      }
    } catch {
      (p as any).vaultIncomplete = true;
      r.warnings.push("Could not reach Vault to verify secrets");
    }
  }
}

export async function redeployLambda(functionName: string): Promise<boolean> {
  try {
    const deps = JSON.parse(await readFile(DEPLOYMENTS_FILE, "utf-8"));
    const dep = deps.find((d: any) => d.functionName === functionName);
    if (!dep?.buildId) return false;

    const metaPath = join(BUILDS_DIR, dep.buildId, "meta.json");
    if (!existsSync(metaPath)) return false;

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const s2 = await loadSettings();
    if (Date.now() - new Date(meta.createdAt).getTime() > s2.cleanup.ttlMinutes * 60 * 1000) return false;
    if (!existsSync(meta.jarPath)) return false;

    const jarBytes = readFileSync(meta.jarPath);
    const client = await getLambdaClient();
    const settings = await loadSettings();
    const memorySize = settings.lambda?.memoryMB ?? 2048;

    let envConfig: { Variables: Record<string, string> } | undefined;
    try {
      const saved = JSON.parse(readFileSync(join(BUILDS_DIR, dep.buildId, "envvars.json"), "utf-8"));
      const vars = Object.fromEntries(saved.filter((e: any) => e.key && !e.isNull).map((e: any) => [e.key, e.value]));
      if (Object.keys(vars).length) envConfig = { Variables: vars };
    } catch {}

    await client.send(new CreateFunctionCommand({
      FunctionName: functionName, Runtime: dep.runtime || "java21",
      Handler: dep.handler, Role: "arn:aws:iam::000000000000:role/lambda-role",
      Code: { ZipFile: jarBytes }, Timeout: 60, MemorySize: memorySize,
      ...(envConfig ? { Environment: envConfig } : {}),
    }));

    console.log(`[reconcile] Redeployed ${functionName} from build ${dep.buildId}`);
    return true;
  } catch (e: any) {
    console.log(`[reconcile] Failed to redeploy ${functionName}: ${e.message}`);
    return false;
  }
}
