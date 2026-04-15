import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { loadSettings } from "./settings.js";

export async function getDynamoClient(): Promise<DynamoDBClient> {
  const s = await loadSettings();
  return new DynamoDBClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}
