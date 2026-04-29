import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const clientCfg = { endpoint: process.env.AWS_ENDPOINT_URL || 'http://host.docker.internal:4566', region: 'us-east-1', forcePathStyle: true };
const s3 = new S3Client(clientCfg);
const sqs = new SQSClient(clientCfg);

export const handler = async (event) => {
  try {
    const bucket = process.env.SHADOW_BUCKET;
    const prefix = process.env.FOLDER_PREFIX;
    const relayUrl = process.env.RELAY_QUEUE_URL;
    const uuid = crypto.randomUUID();
    const ts = Date.now();

    const items = (event.Records || []).map(r => {
      let body = r.body;
      try {
        const parsed = JSON.parse(body);
        return parsed.Message !== undefined ? parsed.Message : body;
      } catch {
        return body;
      }
    });

    const eventKey = `${prefix}/sqs-event-${uuid}-${ts}.json`;
    const itemsKey = `${prefix}/sqs-items-${uuid}-${ts}.json`;

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: eventKey, Body: JSON.stringify(event, null, 2), ContentType: 'application/json' }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: itemsKey, Body: JSON.stringify(items, null, 2), ContentType: 'application/json' }));

    if (relayUrl) {
      for (const item of items) {
        await sqs.send(new SendMessageCommand({ QueueUrl: relayUrl, MessageBody: typeof item === 'string' ? item : JSON.stringify(item) }));
      }
    }

    console.log(`[shadow-app-pipeline-b] Saved ${items.length} SQS items, relayed to ${relayUrl}`);
  } catch (err) {
    console.error('[shadow-app-pipeline-b] Error:', err);
  }
  return { statusCode: 200 };
};
