import { loadSettings } from '../helpers/settings.js';
import { S3Client } from '@aws-sdk/client-s3';

export const SHADOW_BUCKET = 'mouseketool-shadow';

export async function getS3Client(): Promise<S3Client> {
  const s = await loadSettings();
  return new S3Client({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    forcePathStyle: true,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}

export async function ensureBucketExists(): Promise<void> {
  try {
    const s3 = await getS3Client();
    const { HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    await s3.send(new HeadBucketCommand({ Bucket: SHADOW_BUCKET }));
  } catch {
    try {
      const s3 = await getS3Client();
      const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
      await s3.send(new CreateBucketCommand({ Bucket: SHADOW_BUCKET }));
      console.log('[shadow] Recreated missing bucket:', SHADOW_BUCKET);
    } catch {}
  }
}

export async function initShadowInfra(): Promise<void> {
  try {
    const s3 = await getS3Client();
    const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
    try {
      await s3.send(new CreateBucketCommand({ Bucket: SHADOW_BUCKET }));
    } catch (e: any) {
      if (!e.name?.includes('BucketAlreadyExists') && !e.name?.includes('BucketAlreadyOwnedByYou')) throw e;
    }

    // One-time cleanup of old mk-shadow-* resources from previous architecture
    console.log(`[shadow] Shadow S3 bucket ready: ${SHADOW_BUCKET}`);
  } catch (e: any) {
    console.error('[shadow] Failed to initialize:', e.message);
  }
}

export async function listFolderFiles(folder: string): Promise<string[]> {
  const s3 = await getS3Client();
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: SHADOW_BUCKET, Prefix: prefix }));
  return Contents.map(o => o.Key!).filter(Boolean);
}

export async function readS3Json(key: string): Promise<any | null> {
  try {
    const s3 = await getS3Client();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const result = await s3.send(new GetObjectCommand({ Bucket: SHADOW_BUCKET, Key: key }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

export async function moveToProcessed(folder: string, keys: string[]): Promise<void> {
  const s3 = await getS3Client();
  const { CopyObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  for (const key of keys) {
    const filename = key.split('/').pop()!;
    const dest = `${folder}-processed/${filename}`;
    try {
      await s3.send(new CopyObjectCommand({ Bucket: SHADOW_BUCKET, CopySource: `${SHADOW_BUCKET}/${key}`, Key: dest }));
      await s3.send(new DeleteObjectCommand({ Bucket: SHADOW_BUCKET, Key: key }));
    } catch (e: any) {
      console.error(`[shadow] Failed to move ${key}:`, e.message);
    }
  }
}

export async function deleteFolder(folder: string): Promise<void> {
  const s3 = await getS3Client();
  const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
  for (const prefix of [folder, `${folder}-processed`]) {
    const pfx = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: SHADOW_BUCKET, Prefix: pfx }));
    if (Contents.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: SHADOW_BUCKET, Delete: { Objects: Contents.map(o => ({ Key: o.Key! })) } }));
    }
  }
}

async function cleanupLegacyResources(): Promise<void> {
  const PREFIX = 'mk-shadow-';

  // Clean old Lambda functions
  try {
    const { getLambdaClient } = await import('../helpers/lambda-client.js');
    const client = await getLambdaClient();
    const { ListFunctionsCommand, DeleteFunctionCommand, ListEventSourceMappingsCommand, DeleteEventSourceMappingCommand } = await import('@aws-sdk/client-lambda');
    const { Functions = [] } = await client.send(new ListFunctionsCommand({}));
    for (const fn of Functions) {
      if (fn.FunctionName?.startsWith(PREFIX)) {
        try {
          const esms = await client.send(new ListEventSourceMappingsCommand({ FunctionName: fn.FunctionName }));
          for (const esm of esms.EventSourceMappings ?? []) {
            await client.send(new DeleteEventSourceMappingCommand({ UUID: esm.UUID })).catch(() => {});
          }
          await client.send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName }));
          console.log(`[shadow] Deleted legacy Lambda: ${fn.FunctionName}`);
        } catch {}
      }
    }
  } catch (e: any) {
    console.error('[shadow] Legacy Lambda cleanup error:', e.message);
  }

  // Clean old SQS queues
  try {
    const { getSqsClient } = await import('../helpers/sqs-client.js');
    const sqsClient = await getSqsClient();
    const { ListQueuesCommand, DeleteQueueCommand } = await import('@aws-sdk/client-sqs');
    const { QueueUrls = [] } = await sqsClient.send(new ListQueuesCommand({ QueueNamePrefix: PREFIX }));
    for (const url of QueueUrls) {
      try {
        await sqsClient.send(new DeleteQueueCommand({ QueueUrl: url }));
        console.log(`[shadow] Deleted legacy queue: ${url.split('/').pop()}`);
      } catch {}
    }
  } catch (e: any) {
    console.error('[shadow] Legacy SQS cleanup error:', e.message);
  }

  // Clean old S3 buckets
  try {
    const s3 = await getS3Client();
    const { ListBucketsCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand } = await import('@aws-sdk/client-s3');
    const { Buckets = [] } = await s3.send(new ListBucketsCommand({}));
    for (const b of Buckets) {
      if (b.Name?.startsWith(PREFIX)) {
        try {
          const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: b.Name }));
          for (const obj of Contents) {
            await s3.send(new DeleteObjectCommand({ Bucket: b.Name, Key: obj.Key })).catch(() => {});
          }
          await s3.send(new DeleteBucketCommand({ Bucket: b.Name }));
          console.log(`[shadow] Deleted legacy bucket: ${b.Name}`);
        } catch {}
      }
    }
  } catch (e: any) {
    console.error('[shadow] Legacy S3 cleanup error:', e.message);
  }
}
