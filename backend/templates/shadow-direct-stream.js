import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const clientCfg = { endpoint: process.env.AWS_ENDPOINT_URL || 'http://host.docker.internal:4566', region: 'us-east-1', forcePathStyle: true };
const s3 = new S3Client(clientCfg);

function unmarshall(item) {
  if (item == null) return item;
  if (item.S !== undefined) return item.S;
  if (item.N !== undefined) return Number(item.N);
  if (item.BOOL !== undefined) return item.BOOL;
  if (item.NULL) return null;
  if (item.L) return item.L.map(unmarshall);
  if (item.M) return Object.fromEntries(Object.entries(item.M).map(([k, v]) => [k, unmarshall(v)]));
  if (item.SS) return item.SS;
  if (item.NS) return item.NS.map(Number);
  if (typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshall(v)]));
  }
  return item;
}

export const handler = async (event) => {
  try {
    const bucket = process.env.SHADOW_BUCKET;
    const prefix = process.env.FOLDER_PREFIX;
    const uuid = crypto.randomUUID();
    const ts = Date.now();

    const items = (event.Records || [])
      .map(r => r.dynamodb?.NewImage)
      .filter(Boolean)
      .map(unmarshall);

    const eventKey = `${prefix}/event-${uuid}-${ts}.json`;
    const itemsKey = `${prefix}/items-${uuid}-${ts}.json`;

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: eventKey, Body: JSON.stringify(event, null, 2), ContentType: 'application/json' }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: itemsKey, Body: JSON.stringify(items, null, 2), ContentType: 'application/json' }));

    console.log(`[shadow-direct-stream] Saved ${items.length} items to s3://${bucket}/${itemsKey}`);
  } catch (err) {
    console.error('[shadow-direct-stream] Error:', err);
  }
  return { statusCode: 200 };
};
