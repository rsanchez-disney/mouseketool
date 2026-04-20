import { getLambdaClient } from "../helpers/lambda-client.js";
import { getSqsClient } from "../helpers/sqs-client.js";
import { loadSettings } from "../helpers/settings.js";
import { loadPipelines, savePipelines, type Pipeline } from "./pipeline-watcher.js";
import { SETTINGS_DIR } from "../config/constants.js";
import { readFileSync, mkdirSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHADOW_SUFFIX = Math.random().toString(36).slice(2, 8);
const SHADOW_FUNCTION = `mk-shadow-${SHADOW_SUFFIX}`;
const SHADOW_QUEUE = `mk-shadow-${SHADOW_SUFFIX}`;
const CAPTURES_BUCKET = `mk-shadow-${SHADOW_SUFFIX}`;
const SHADOW_PREFIX = "mk-shadow-";

export function getShadowQueueName() { return SHADOW_QUEUE; }

async function getSnsClient() {
  const { getSnsClient: get } = await import("../helpers/sns-client.js");
  return get();
}

async function getS3Client() {
  const s = await loadSettings();
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region, forcePathStyle: true,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
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

function buildTopicMap(): Record<string, string> {
  const pipelines = loadPipelines();
  const map: Record<string, string> = {};
  for (const p of pipelines) map[p.topicArn] = p.id;
  return map;
}

async function cleanupOldShadow() {
  console.log("[shadow] Cleaning up old shadow resources...");
  const client = await getLambdaClient();
  const sqsClient = await getSqsClient();

  // Delete old shadow Lambdas
  try {
    const { ListFunctionsCommand, DeleteFunctionCommand } = await import("@aws-sdk/client-lambda");
    const fns = await client.send(new ListFunctionsCommand({}));
    for (const fn of fns.Functions ?? []) {
      if (fn.FunctionName?.startsWith(SHADOW_PREFIX) && fn.FunctionName !== SHADOW_FUNCTION) {
        try {
          // Delete ESMs first
          const { ListEventSourceMappingsCommand, DeleteEventSourceMappingCommand } = await import("@aws-sdk/client-lambda");
          const esms = await client.send(new ListEventSourceMappingsCommand({ FunctionName: fn.FunctionName }));
          for (const esm of esms.EventSourceMappings ?? []) await client.send(new DeleteEventSourceMappingCommand({ UUID: esm.UUID })).catch(() => {});
          await client.send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName }));
          console.log(`[shadow] Deleted old Lambda: ${fn.FunctionName}`);
        } catch {}
      }
    }
  } catch {}

  // Delete old shadow SQS queues
  try {
    const { ListQueuesCommand, DeleteQueueCommand } = await import("@aws-sdk/client-sqs");
    const qs = await sqsClient.send(new ListQueuesCommand({ QueueNamePrefix: SHADOW_PREFIX }));
    for (const url of qs.QueueUrls ?? []) {
      const name = url.split("/").pop() || "";
      if (name.startsWith(SHADOW_PREFIX) && name !== SHADOW_QUEUE) {
        try { await sqsClient.send(new DeleteQueueCommand({ QueueUrl: url })); console.log(`[shadow] Deleted old queue: ${name}`); } catch {}
      }
    }
  } catch {}

  // Delete old shadow S3 buckets
  try {
    const s3 = await getS3Client();
    const { ListBucketsCommand, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const buckets = await s3.send(new ListBucketsCommand({}));
    for (const b of buckets.Buckets ?? []) {
      if (b.Name?.startsWith(SHADOW_PREFIX) && b.Name !== CAPTURES_BUCKET) {
        try {
          const objs = await s3.send(new ListObjectsV2Command({ Bucket: b.Name }));
          for (const obj of objs.Contents ?? []) await s3.send(new DeleteObjectCommand({ Bucket: b.Name, Key: obj.Key })).catch(() => {});
          await s3.send(new DeleteBucketCommand({ Bucket: b.Name }));
          console.log(`[shadow] Deleted old bucket: ${b.Name}`);
        } catch {}
      }
    }
  } catch {}
}

export async function initShadowInfra() {
  console.log("[shadow] Initializing shadow infrastructure (suffix: " + SHADOW_SUFFIX + ")...");
  try {
    // 0. Clean up old shadow resources from previous boots
    await cleanupOldShadow();

    // 1. Create S3 bucket for captures
    try {
      const s3 = await getS3Client();
      const { CreateBucketCommand } = await import("@aws-sdk/client-s3");
      await s3.send(new CreateBucketCommand({ Bucket: CAPTURES_BUCKET }));
      console.log("[shadow] Created S3 bucket:", CAPTURES_BUCKET);
    } catch (e: any) {
      if (!e.name?.includes("BucketAlreadyExists") && !e.name?.includes("BucketAlreadyOwnedByYou")) throw e;
      console.log("[shadow] S3 bucket already exists:", CAPTURES_BUCKET);
    }

    // 2. Create SQS queue
    const sqsClient = await getSqsClient();
    const { CreateQueueCommand, GetQueueAttributesCommand } = await import("@aws-sdk/client-sqs");
    let queueUrl: string;
    let queueArn: string;
    try {
      const result = await sqsClient.send(new CreateQueueCommand({ QueueName: SHADOW_QUEUE }));
      queueUrl = result.QueueUrl!;
      console.log("[shadow] Created SQS queue:", SHADOW_QUEUE);
    } catch (e: any) {
      if (e.name === "QueueNameExists" || e.name === "QueueAlreadyExists") {
        const { GetQueueUrlCommand } = await import("@aws-sdk/client-sqs");
        queueUrl = (await sqsClient.send(new GetQueueUrlCommand({ QueueName: SHADOW_QUEUE }))).QueueUrl!;
        console.log("[shadow] SQS queue already exists:", SHADOW_QUEUE);
      } else throw e;
    }
    const { QueueAttributeName } = await import("@aws-sdk/client-sqs");
    const attrs = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: [QueueAttributeName.QueueArn] }));
    queueArn = attrs.Attributes?.QueueArn || "";

    // 3. Deploy shadow Lambda
    const client = await getLambdaClient();
    const { GetFunctionCommand, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, CreateEventSourceMappingCommand, ListEventSourceMappingsCommand } = await import("@aws-sdk/client-lambda");

    const srcPath = join(__dirname, "..", "..", "src", "templates", "shadow-capture.js");
    const src = readFileSync(srcPath);
    const zipPath = join(SETTINGS_DIR, "shadow-capture.zip");
    mkdirSync(SETTINGS_DIR, { recursive: true });
    await createZip([{ name: "index.js", content: src }], zipPath);
    const zipBytes = readFileSync(zipPath);

    const topicMap = buildTopicMap();
    const s = await loadSettings();
    const isLocal = ["localhost", "127.0.0.1"].includes(s.localstack.host);
    const envVars: Record<string, string> = {
      CAPTURES_BUCKET,
      TOPIC_MAP: JSON.stringify(topicMap),
    };
    // For remote LocalStack, pass the endpoint explicitly since LOCALSTACK_HOSTNAME won't resolve
    if (!isLocal) envVars.AWS_ENDPOINT_URL = `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`;

    let exists = false;
    try { await client.send(new GetFunctionCommand({ FunctionName: SHADOW_FUNCTION })); exists = true; } catch {}

    if (exists) {
      await client.send(new UpdateFunctionCodeCommand({ FunctionName: SHADOW_FUNCTION, ZipFile: zipBytes }));
      await new Promise(r => setTimeout(r, 500));
      await client.send(new UpdateFunctionConfigurationCommand({ FunctionName: SHADOW_FUNCTION, Environment: { Variables: envVars } }));
      console.log("[shadow] Updated shadow Lambda");
    } else {
      await client.send(new CreateFunctionCommand({
        FunctionName: SHADOW_FUNCTION, Runtime: "nodejs20.x", Handler: "index.handler",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Code: { ZipFile: zipBytes }, Timeout: 30, MemorySize: 128,
        Environment: { Variables: envVars },
      }));
      console.log("[shadow] Created shadow Lambda");
    }

    // 4. Wire SQS → shadow Lambda ESM (if not already)
    const esms = await client.send(new ListEventSourceMappingsCommand({ FunctionName: SHADOW_FUNCTION }));
    const hasEsm = esms.EventSourceMappings?.some(m => m.EventSourceArn === queueArn);
    if (!hasEsm) {
      await client.send(new CreateEventSourceMappingCommand({ FunctionName: SHADOW_FUNCTION, EventSourceArn: queueArn, BatchSize: 10, Enabled: true }));
      console.log("[shadow] Created ESM: shadow queue → shadow Lambda");
    } else {
      console.log("[shadow] ESM already exists for shadow queue");
    }

    console.log("[shadow] Shadow infrastructure ready");

    // Re-subscribe shadow queue to all existing pipelines' topics
    const pipelines = loadPipelines();
    for (const p of pipelines) {
      if (p.topicArn) {
        const subArn = await subscribeShadowQueue(p.topicArn, p.filterPolicy as any, p.filterPolicyScope);
        if (subArn) {
          const updated = loadPipelines();
          const pp = updated.find(u => u.id === p.id);
          if (pp) { pp.shadowSubscriptionArn = subArn; savePipelines(updated); }
        }
      }
    }
    if (pipelines.length) console.log(`[shadow] Re-subscribed shadow queue to ${pipelines.length} pipeline(s)`);
  } catch (e: any) {
    console.error("[shadow] Failed to initialize:", e.message, "— retrying in 5s");
    setTimeout(initShadowInfra, 5000);
  }
}

// Subscribe shadow queue to a pipeline's SNS topic
export async function subscribeShadowQueue(topicArn: string, filterPolicy?: Record<string, unknown>, filterPolicyScope?: string) {
  try {
    const snsClient = await getSnsClient();
    const sqsClient = await getSqsClient();
    const { GetQueueUrlCommand, GetQueueAttributesCommand, QueueAttributeName } = await import("@aws-sdk/client-sqs");
    const { SubscribeCommand } = await import("@aws-sdk/client-sns");

    const queueUrl = (await sqsClient.send(new GetQueueUrlCommand({ QueueName: SHADOW_QUEUE }))).QueueUrl!;
    const attrs = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: [QueueAttributeName.QueueArn] }));
    const queueArn = attrs.Attributes?.QueueArn || "";

    const { SubscriptionArn } = await snsClient.send(new SubscribeCommand({ TopicArn: topicArn, Protocol: "sqs", Endpoint: queueArn }));
    console.log(`[shadow] Subscribed shadow queue to ${topicArn} → ${SubscriptionArn}`);

    if (filterPolicy && Object.keys(filterPolicy).length && SubscriptionArn) {
      const { SetSubscriptionAttributesCommand } = await import("@aws-sdk/client-sns");
      await snsClient.send(new SetSubscriptionAttributesCommand({ SubscriptionArn, AttributeName: "FilterPolicy", AttributeValue: JSON.stringify(filterPolicy) }));
      if (filterPolicyScope) await snsClient.send(new SetSubscriptionAttributesCommand({ SubscriptionArn, AttributeName: "FilterPolicyScope", AttributeValue: filterPolicyScope }));
      console.log(`[shadow] Applied filter policy to shadow subscription`);
    }

    // Update TOPIC_MAP on the shadow Lambda
    await updateTopicMap();
    return SubscriptionArn;
  } catch (e: any) {
    console.error(`[shadow] Failed to subscribe to ${topicArn}:`, e.message);
    return undefined;
  }
}

// Unsubscribe shadow queue from a topic
export async function unsubscribeShadowQueue(subscriptionArn: string) {
  try {
    const snsClient = await getSnsClient();
    const { UnsubscribeCommand } = await import("@aws-sdk/client-sns");
    await snsClient.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
    console.log(`[shadow] Unsubscribed: ${subscriptionArn}`);
    await updateTopicMap();
  } catch (e: any) {
    console.error(`[shadow] Failed to unsubscribe:`, e.message);
  }
}

// Update the TOPIC_MAP env var on the shadow Lambda
async function updateTopicMap() {
  try {
    const client = await getLambdaClient();
    const { GetFunctionCommand, UpdateFunctionConfigurationCommand } = await import("@aws-sdk/client-lambda");
    const fn = await client.send(new GetFunctionCommand({ FunctionName: SHADOW_FUNCTION }));
    const currentEnv = fn.Configuration?.Environment?.Variables || {};
    currentEnv.TOPIC_MAP = JSON.stringify(buildTopicMap());
    await client.send(new UpdateFunctionConfigurationCommand({ FunctionName: SHADOW_FUNCTION, Environment: { Variables: currentEnv } }));
    console.log("[shadow] Updated TOPIC_MAP");
  } catch (e: any) {
    console.error("[shadow] Failed to update TOPIC_MAP:", e.message);
  }
}

// Read captured payload for a pipeline
export async function getCapturedPayload(pipelineId: string): Promise<any | null> {
  try {
    const s3 = await getS3Client();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const result = await s3.send(new GetObjectCommand({ Bucket: CAPTURES_BUCKET, Key: `captures/${pipelineId}/latest.json` }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch { return null; }
}


export async function getCapturedItems(pipelineId: string): Promise<string[]> {
  try {
    const s3 = await getS3Client();
    const { ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
    console.log(`[shadow] getCapturedItems: bucket=${CAPTURES_BUCKET}, prefix=captures/${pipelineId}/items/`);
    const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: CAPTURES_BUCKET, Prefix: `captures/${pipelineId}/items/` }));
    console.log(`[shadow] getCapturedItems: found ${Contents.length} items`);
    if (!Contents.length) return [];
    const items: string[] = [];
    for (const obj of Contents) {
      if (!obj.Key) continue;
      const r = await s3.send(new GetObjectCommand({ Bucket: CAPTURES_BUCKET, Key: obj.Key }));
      const body = await r.Body?.transformToString();
      if (body) items.push(body);
    }
    return items;
  } catch { return []; }
}

export async function clearCapturedItems(pipelineId: string): Promise<void> {
  try {
    const s3 = await getS3Client();
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
    const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: CAPTURES_BUCKET, Prefix: `captures/${pipelineId}/items/` }));
    if (Contents.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: CAPTURES_BUCKET, Delete: { Objects: Contents.map(o => ({ Key: o.Key! })) } }));
    }
  } catch {}
}

