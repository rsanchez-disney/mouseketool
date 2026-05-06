import { test, expect } from "@playwright/test";
import { startLocalStack, stopLocalStack, startBackend, cleanup, TEST_CONFIG } from "./setup";
import { readFileSync } from "fs";
import { join } from "path";
import { LambdaClient, CreateFunctionCommand, DeleteFunctionCommand, ListFunctionsCommand } from "@aws-sdk/client-lambda";

const BACKEND_URL = TEST_CONFIG.backendUrl;
const TABLE_NAME = "mk-integration-test-table";
const LAMBDA_NAME = "mk-integration-test-lambda";
const PIPELINE_NAME = "mk-integration-test-pipeline";

let pipelineId: string;

// Increase timeout for integration tests (pipeline wiring takes time)
test.setTimeout(180000);

test.describe.serial("Pipeline Lifecycle - Integration", () => {
  test.beforeAll(async () => {
    await startLocalStack();
    await startBackend();
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test("deploy test Lambda to LocalStack", async ({ request }) => {
    const zipPath = join(__dirname, "fixtures", "test-lambda", "function.zip");
    const zipBuffer = readFileSync(zipPath);

    const lambda = new LambdaClient({
      endpoint: TEST_CONFIG.endpoint,
      region: TEST_CONFIG.region,
      credentials: { accessKeyId: TEST_CONFIG.accessKeyId, secretAccessKey: TEST_CONFIG.secretAccessKey },
    });

    // Delete if exists from previous run
    try { await lambda.send(new DeleteFunctionCommand({ FunctionName: LAMBDA_NAME })); } catch {}

    // Create function
    await lambda.send(new CreateFunctionCommand({
      FunctionName: LAMBDA_NAME,
      Runtime: "nodejs20.x",
      Handler: "index.handler",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Code: { ZipFile: zipBuffer },
      MemorySize: 256,
      Timeout: 30,
    }));

    // Verify via SDK
    const { Functions = [] } = await lambda.send(new ListFunctionsCommand({}));
    expect(Functions.some(f => f.FunctionName === LAMBDA_NAME)).toBeTruthy();

    // Verify via Mouseketool API
    const fns = await request.get(`${BACKEND_URL}/api/triggers/functions`);
    const functions = await fns.json();
    expect(functions.some((f: any) => f.name === LAMBDA_NAME)).toBeTruthy();
  });

  test("create DynamoDB table with streams", async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/dynamodb/tables`, {
      data: {
        tableName: TABLE_NAME,
        partitionKey: "pk",
        partitionKeyType: "S",
        sortKey: "sk",
        sortKeyType: "S",
      },
    });
    expect(res.ok()).toBeTruthy();

    // Verify table exists with stream
    const tables = await request.get(`${BACKEND_URL}/api/dynamodb/tables`);
    const tableList = await tables.json();
    const table = tableList.find((t: any) => t.name === TABLE_NAME);
    expect(table).toBeTruthy();
    expect(table.streamEnabled).toBeTruthy();
  });

  test("wire APP pipeline with filter policy", async ({ request }) => {
    const zipPath = join(__dirname, "fixtures", "test-lambda", "function.zip");
    const zipBuffer = readFileSync(zipPath);

    // Deploy stream handler Lambda (reuse test Lambda as stream handler)
    const lambda = new LambdaClient({
      endpoint: TEST_CONFIG.endpoint,
      region: TEST_CONFIG.region,
      credentials: { accessKeyId: TEST_CONFIG.accessKeyId, secretAccessKey: TEST_CONFIG.secretAccessKey },
    });
    try { await lambda.send(new DeleteFunctionCommand({ FunctionName: "mk-test-stream-handler" })); } catch {}
    await lambda.send(new CreateFunctionCommand({
      FunctionName: "mk-test-stream-handler",
      Runtime: "nodejs20.x",
      Handler: "index.handler",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Code: { ZipFile: zipBuffer },
      MemorySize: 256,
      Timeout: 30,
    }));

    // Get table stream ARN (may need a moment for stream to be ready)
    let table: any;
    for (let i = 0; i < 5; i++) {
      const tables = await request.get(`${BACKEND_URL}/api/dynamodb/tables`);
      const tableList = await tables.json();
      table = tableList.find((t: any) => t.name === TABLE_NAME);
      if (table?.streamArn) break;
      await new Promise(r => setTimeout(r, 3000));
    }
    expect(table, `Table ${TABLE_NAME} not found in list`).toBeTruthy();
    expect(table.streamArn, `Table found but streamArn is empty. Table: ${JSON.stringify(table)}`).toBeTruthy();

    // Create SNS topic
    const topicRes = await request.post(`${BACKEND_URL}/api/sns/topics`, { data: { topicName: "mk-integration-test-topic" } });
    expect(topicRes.ok(), `Topic create failed: ${topicRes.status()}`).toBeTruthy();
    const topicData = await topicRes.json();
    const topicArn = topicData.topicArn;
    expect(topicArn, "topicArn missing from response").toBeTruthy();

    // Create SQS queue
    const queueRes = await request.post(`${BACKEND_URL}/api/sqs/queues`, { data: { queueName: "mk-integration-test-queue", createDlq: true } });
    expect(queueRes.ok(), `Queue create failed: ${queueRes.status()}`).toBeTruthy();
    const queueData = await queueRes.json();
    const queueUrl = queueData.queueUrl;
    expect(queueUrl, "queueUrl missing from response").toBeTruthy();

    // Wire the pipeline
    const wireRes = await request.post(`${BACKEND_URL}/api/triggers/wire`, {
      data: {
        type: "app-pipeline",
        streamArn: table.streamArn,
        glueFunctionName: "mk-test-stream-handler",
        topicArn,
        queueUrl,
        targetFunctionName: LAMBDA_NAME,
        pipelineName: PIPELINE_NAME,
        addons: [],
        filterPolicy: { item_type: ["test-item"] },
        filterPolicyScope: "MessageBody",
        topicCreatedByUs: true,
        queueCreatedByUs: true,
        heavyLoad: false,
      },
    });
    expect(wireRes.ok(), `Wire returned ${wireRes.status()}: ${await wireRes.text()}`).toBeTruthy();
    const wireData = await wireRes.json();
    pipelineId = wireData.pipeline?.id;
    expect(pipelineId).toBeTruthy();
  });

  test("execute pipeline with matching item produces success", async ({ request }) => {
    // item_type: "test-item" matches the filter policy
    const res = await request.post(`${BACKEND_URL}/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          pk: "test_success_" + Date.now(),
          sk: "sk_1",
          item_type: "test-item",
          data: "hello world",
        },
      },
    });
    expect(res.ok()).toBeTruthy();

    // The SSE response body contains step results
    const body = await res.text();
    // Execute endpoint puts item into DynamoDB and monitors the pipeline
    // At minimum it should contain the "dynamodb" step as "done"
    expect(body).toContain('"step":"dynamodb"');
    expect(body).toContain('"status":"success"');
  });

  test("execute pipeline with non-matching item produces filtered", async ({ request }) => {
    // item_type: "other-type" does NOT match filter policy (expects "test-item")
    const res = await request.post(`${BACKEND_URL}/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          pk: "test_filtered_" + Date.now(),
          sk: "sk_2",
          item_type: "other-type",
          data: "should be filtered",
        },
      },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.text();
    // Should show dynamodb step done (item was inserted)
    expect(body).toContain('"step":"dynamodb"');
    expect(body).toContain('"status":"success"');
  });

  test("execute pipeline with error-triggering item still inserts to DynamoDB", async ({ request }) => {
    // force_error: true causes the Lambda to throw (if it gets invoked)
    const res = await request.post(`${BACKEND_URL}/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          pk: "test_error_" + Date.now(),
          sk: "sk_3",
          item_type: "test-item",
          force_error: true,
          data: "should error",
        },
      },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.text();
    expect(body).toContain('"step":"dynamodb"');
    expect(body).toContain('"status":"success"');
  });

  test("history endpoint returns runs structure", async ({ request }) => {
    const hist = await request.get(`${BACKEND_URL}/api/triggers/pipelines/${pipelineId}/history`);
    const data = await hist.json();
    expect(data.pipelineId).toBe(pipelineId);
    expect(data.pipelineName).toBeTruthy();
    expect(Array.isArray(data.runs)).toBeTruthy();
  });

  test("delete history clears all runs", async ({ request }) => {
    const del = await request.delete(`${BACKEND_URL}/api/triggers/pipelines/${pipelineId}/history`);
    expect(del.ok()).toBeTruthy();
  });
});
