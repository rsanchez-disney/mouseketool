import { SNSClient } from "@aws-sdk/client-sns";
import { loadSettings } from "./settings.js";

export async function getSnsClient(): Promise<SNSClient> {
  const s = await loadSettings();
  return new SNSClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}
