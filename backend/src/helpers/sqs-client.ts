import { SQSClient } from "@aws-sdk/client-sqs";
import { loadSettings } from "./settings.js";

export async function getSqsClient(): Promise<SQSClient> {
  const s = await loadSettings();
  return new SQSClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}
