import { LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { loadSettings } from "./settings.js";

export async function getLambdaClient(): Promise<LambdaClient> {
  const s = await loadSettings();
  return new LambdaClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 10000,
      requestTimeout: 600000, // 10 min - Java Lambdas can be slow on cold start
    }),
  });
}
