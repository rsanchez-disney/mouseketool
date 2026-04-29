import { readFileSync, createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { getSqsClient } from "../helpers/sqs-client.js";
import { loadSettings } from "../helpers/settings.js";
import { type Pipeline } from "./pipeline-watcher.js";
import { SETTINGS_DIR } from "../config/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAG = "[shadow-deploy]";

export interface ShadowMeta {
  bucket: string;
  folder: string;
  lambdaA?: string;
  lambdaAArn?: string;
  lambdaAEsmUuid?: string;
  lambdaB?: string;
  lambdaBArn?: string;
  lambdaBEsmUuid?: string;
  relayQueueName?: string;
  relayQueueUrl?: string;
  relayQueueArn?: string;
}

function createZip(files: { name: string; content: Buffer }[], outPath: string): Promise<void> {
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

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 30);
}

function templatePath(filename: string): string {
  return join(__dirname, "..", "..", "src", "templates", filename);
}

async function zipTemplate(templateFile: string): Promise<Buffer> {
  const src = readFileSync(templatePath(templateFile));
  const zipPath = join(SETTINGS_DIR, `shadow-${Date.now()}.zip`);
  mkdirSync(SETTINGS_DIR, { recursive: true });
  await createZip([{ name: "index.mjs", content: src }], zipPath);
  return readFileSync(zipPath);
}

async function getDynamoStreamArn(tableName: string): Promise<string> {
  const { DynamoDBClient, DescribeTableCommand } = await import("@aws-sdk/client-dynamodb");
  const s = await loadSettings();
  const client = new DynamoDBClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
  const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const arn = Table?.LatestStreamArn;
  if (!arn) throw new Error(`No stream ARN found for table ${tableName}`);
  console.log(`${TAG} Stream ARN for ${tableName}: ${arn}`);
  return arn;
}

async function getQueueArn(queueUrl: string): Promise<string> {
  const sqsClient = await getSqsClient();
  const { GetQueueAttributesCommand } = await import("@aws-sdk/client-sqs");
  const attrs = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] }));
  const arn = attrs.Attributes?.QueueArn;
  if (!arn) throw new Error(`No ARN found for queue ${queueUrl}`);
  return arn;
}

async function createShadowLambda(name: string, zipBytes: Buffer, envVars: Record<string, string>): Promise<string> {
  const client = await getLambdaClient();
  const { CreateFunctionCommand } = await import("@aws-sdk/client-lambda");
  const result = await client.send(new CreateFunctionCommand({
    FunctionName: name, Runtime: "nodejs20.x", Handler: "index.handler",
    Role: "arn:aws:iam::000000000000:role/lambda-role",
    Code: { ZipFile: zipBytes }, Timeout: 30, MemorySize: 128,
    Environment: { Variables: envVars },
  }));
  console.log(`${TAG} Created Lambda: ${name}`);
  return result.FunctionArn!;
}

async function createEsm(functionName: string, sourceArn: string, batchSize: number, startingPosition?: string): Promise<string> {
  const client = await getLambdaClient();
  const { CreateEventSourceMappingCommand } = await import("@aws-sdk/client-lambda");
  const params: any = { FunctionName: functionName, EventSourceArn: sourceArn, BatchSize: batchSize, Enabled: true };
  if (startingPosition) params.StartingPosition = startingPosition;
  const result = await client.send(new CreateEventSourceMappingCommand(params));
  console.log(`${TAG} Created ESM: ${sourceArn.split(":").pop()} → ${functionName} (${result.UUID})`);
  return result.UUID!;
}

async function createRelayQueue(pipelineId: string): Promise<{ name: string; url: string; arn: string }> {
  const sqsClient = await getSqsClient();
  const { CreateQueueCommand, GetQueueAttributesCommand } = await import("@aws-sdk/client-sqs");
  const name = `mk-relay-${pipelineId.slice(0, 8)}`;
  const { QueueUrl } = await sqsClient.send(new CreateQueueCommand({ QueueName: name }));
  const attrs = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: QueueUrl!, AttributeNames: ["QueueArn"] }));
  console.log(`${TAG} Created relay queue: ${name}`);
  return { name, url: QueueUrl!, arn: attrs.Attributes?.QueueArn || "" };
}

function buildEnvVars(pipeline: Pipeline, folder: string, extra?: Record<string, string>): Record<string, string> {
  const { getS3Client: _, ...rest } = {} as any; // unused, just for clarity
  return {
    SHADOW_BUCKET: `mk-shadow-bucket`,
    PIPELINE_ID: pipeline.id,
    PIPELINE_NAME: pipeline.name,
    FOLDER_PREFIX: folder,
    ...extra,
  };
}

async function deployDirectStream(pipeline: Pipeline): Promise<ShadowMeta> {
  const folder = `${sanitizeName(pipeline.name)}-${pipeline.id}-direct-stream-${Date.now()}`;
  const lambdaName = `mk-shadow-${pipeline.id.slice(0, 8)}`;
  const zipBytes = await zipTemplate("shadow-direct-stream.js");
  const envVars = buildEnvVars(pipeline, folder);
  const lambdaArn = await createShadowLambda(lambdaName, zipBytes, envVars);
  const streamArn = await getDynamoStreamArn(pipeline.tableName);
  const esmUuid = await createEsm(lambdaName, streamArn, 10, "LATEST");
  return { bucket: envVars.SHADOW_BUCKET, folder, lambdaA: lambdaName, lambdaAArn: lambdaArn, lambdaAEsmUuid: esmUuid };
}

async function deployQueueConsumer(pipeline: Pipeline): Promise<ShadowMeta> {
  const folder = `${sanitizeName(pipeline.name)}-${pipeline.id}-queue-consumer-${Date.now()}`;
  const relay = await createRelayQueue(pipeline.id);
  const lambdaName = `mk-shadow-${pipeline.id.slice(0, 8)}`;
  const zipBytes = await zipTemplate("shadow-queue-consumer.js");
  const envVars = buildEnvVars(pipeline, folder, { RELAY_QUEUE_URL: relay.url });
  const lambdaArn = await createShadowLambda(lambdaName, zipBytes, envVars);
  const queueArn = await getQueueArn(pipeline.queueUrl);
  const esmUuid = await createEsm(lambdaName, queueArn, 10);
  return {
    bucket: envVars.SHADOW_BUCKET, folder,
    lambdaB: lambdaName, lambdaBArn: lambdaArn, lambdaBEsmUuid: esmUuid,
    relayQueueName: relay.name, relayQueueUrl: relay.url, relayQueueArn: relay.arn,
  };
}

async function deployAppPipeline(pipeline: Pipeline): Promise<ShadowMeta> {
  const folder = `${sanitizeName(pipeline.name)}-${pipeline.id}-app-pipeline-${Date.now()}`;
  const relay = await createRelayQueue(pipeline.id);

  // Lambda A — DynamoDB stream capture
  const lambdaAName = `mk-shadow-a-${pipeline.id.slice(0, 8)}`;
  const zipA = await zipTemplate("shadow-app-pipeline-a.js");
  const envA = buildEnvVars(pipeline, folder);
  const lambdaAArn = await createShadowLambda(lambdaAName, zipA, envA);
  const streamArn = await getDynamoStreamArn(pipeline.tableName);
  const esmAUuid = await createEsm(lambdaAName, streamArn, 10, "LATEST");

  // Lambda B — SQS capture + relay
  const lambdaBName = `mk-shadow-b-${pipeline.id.slice(0, 8)}`;
  const zipB = await zipTemplate("shadow-app-pipeline-b.js");
  const envB = buildEnvVars(pipeline, folder, { RELAY_QUEUE_URL: relay.url });
  const lambdaBArn = await createShadowLambda(lambdaBName, zipB, envB);
  const queueArn = await getQueueArn(pipeline.queueUrl);
  const esmBUuid = await createEsm(lambdaBName, queueArn, 10);

  return {
    bucket: envA.SHADOW_BUCKET, folder,
    lambdaA: lambdaAName, lambdaAArn, lambdaAEsmUuid: esmAUuid,
    lambdaB: lambdaBName, lambdaBArn, lambdaBEsmUuid: esmBUuid,
    relayQueueName: relay.name, relayQueueUrl: relay.url, relayQueueArn: relay.arn,
  };
}

export async function deployShadowForPipeline(pipeline: Pipeline): Promise<ShadowMeta> {
  console.log(`${TAG} Deploying shadow for pipeline "${pipeline.name}" (type: ${pipeline.type})`);
  switch (pipeline.type) {
    case "direct-stream": return deployDirectStream(pipeline);
    case "queue-consumer": return deployQueueConsumer(pipeline);
    case "app-pipeline": return deployAppPipeline(pipeline);
    default: throw new Error(`Unsupported pipeline type: ${pipeline.type}`);
  }
}

async function deleteLambdaWithEsm(functionName: string, esmUuid?: string): Promise<void> {
  const client = await getLambdaClient();
  const { DeleteEventSourceMappingCommand, DeleteFunctionCommand } = await import("@aws-sdk/client-lambda");
  if (esmUuid) {
    try { await client.send(new DeleteEventSourceMappingCommand({ UUID: esmUuid })); console.log(`${TAG} Deleted ESM: ${esmUuid}`); } catch {}
  }
  try { await client.send(new DeleteFunctionCommand({ FunctionName: functionName })); console.log(`${TAG} Deleted Lambda: ${functionName}`); } catch {}
}

async function deleteQueue(queueUrl: string): Promise<void> {
  const sqsClient = await getSqsClient();
  const { DeleteQueueCommand } = await import("@aws-sdk/client-sqs");
  try { await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })); console.log(`${TAG} Deleted queue: ${queueUrl}`); } catch {}
}

export async function destroyShadow(pipeline: Pipeline): Promise<void> {
  const shadow = (pipeline as any).shadow as ShadowMeta | undefined;
  if (!shadow) { console.log(`${TAG} No shadow metadata for pipeline "${pipeline.name}"`); return; }
  console.log(`${TAG} Destroying shadow for pipeline "${pipeline.name}"`);
  if (shadow.lambdaA) await deleteLambdaWithEsm(shadow.lambdaA, shadow.lambdaAEsmUuid);
  if (shadow.lambdaB) await deleteLambdaWithEsm(shadow.lambdaB, shadow.lambdaBEsmUuid);
  if (shadow.relayQueueUrl) await deleteQueue(shadow.relayQueueUrl);
  console.log(`${TAG} Shadow destroyed for pipeline "${pipeline.name}"`);
}

async function lambdaExists(name: string): Promise<boolean> {
  const client = await getLambdaClient();
  const { GetFunctionCommand } = await import("@aws-sdk/client-lambda");
  try { await client.send(new GetFunctionCommand({ FunctionName: name })); return true; } catch { return false; }
}

async function queueExists(url: string): Promise<boolean> {
  const sqsClient = await getSqsClient();
  const { GetQueueAttributesCommand } = await import("@aws-sdk/client-sqs");
  try { await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] })); return true; } catch { return false; }
}

export async function reconcileShadow(pipeline: Pipeline): Promise<ShadowMeta | null> {
  if (!pipeline.type) { console.log(`${TAG} Pipeline "${pipeline.name}" has no type — skipping reconcile`); return null; }
  const shadow = (pipeline as any).shadow as ShadowMeta | undefined;
  if (!shadow) { console.log(`${TAG} No shadow for pipeline "${pipeline.name}" — deploying fresh`); return deployShadowForPipeline(pipeline); }

  console.log(`${TAG} Reconciling shadow for pipeline "${pipeline.name}"`);
  let healthy = true;

  if (shadow.lambdaA && !(await lambdaExists(shadow.lambdaA))) { console.log(`${TAG} Lambda A missing: ${shadow.lambdaA}`); healthy = false; }
  if (shadow.lambdaB && !(await lambdaExists(shadow.lambdaB))) { console.log(`${TAG} Lambda B missing: ${shadow.lambdaB}`); healthy = false; }
  if (shadow.relayQueueUrl && !(await queueExists(shadow.relayQueueUrl))) { console.log(`${TAG} Relay queue missing: ${shadow.relayQueueUrl}`); healthy = false; }

  if (!healthy) {
    console.log(`${TAG} Shadow resources missing — recreating`);
    await destroyShadow(pipeline);
    return deployShadowForPipeline(pipeline);
  }

  console.log(`${TAG} Shadow healthy for pipeline "${pipeline.name}"`);
  return shadow;
}
