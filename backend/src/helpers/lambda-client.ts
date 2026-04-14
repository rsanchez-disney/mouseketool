import { LambdaClient } from "@aws-sdk/client-lambda";
import { loadSettings } from "./settings.js";

export async function getLambdaClient(): Promise<LambdaClient> {
  const s = await loadSettings();
  return new LambdaClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}
