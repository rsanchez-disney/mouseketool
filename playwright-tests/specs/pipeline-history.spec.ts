import { test, expect } from "./fixtures";

test.describe("Pipeline - API & History", () => {
  let pipelineId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/triggers/pipelines");
    const pipelines = await res.json();
    if (!pipelines.length) throw new Error("No pipelines configured - cannot run pipeline tests");
    pipelineId = pipelines[0].id;
  });

  test("GET /pipelines returns at least one pipeline with required fields", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/triggers/pipelines");
    const pipelines = await res.json();
    expect(pipelines.length).toBeGreaterThan(0);

    const p = pipelines[0];
    expect(p.id).toBeTruthy();
    expect(p.type).toBeTruthy();
    expect(p.targetFunctionName).toBeTruthy();
    expect(p.tableName).toBeTruthy();
  });

  test("GET /pipelines/:id/history returns object with runs array", async ({ request }) => {
    const res = await request.get(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/history`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.pipelineId).toBe(pipelineId);
    expect(data.pipelineName).toBeTruthy();
    expect(Array.isArray(data.runs)).toBeTruthy();
  });

  test("pipeline has filter policy configured", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/triggers/pipelines");
    const pipelines = await res.json();
    const p = pipelines.find((pl: any) => pl.id === pipelineId);

    expect(p.filterPolicy).toBeTruthy();
    expect(p.filterPolicyScope).toBe("MessageBody");
  });

  test("GET /pipelines/:id/resources returns resource metadata", async ({ request }) => {
    const res = await request.get(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/resources`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.dynamodb).toBeTruthy();
    expect(data.dynamodb.tableName).toBeTruthy();
    expect(data.sns).toBeTruthy();
    expect(data.sns.topicName).toBeTruthy();
    expect(data.sqs).toBeTruthy();
    expect(data.sqs.queueName).toBeTruthy();
    expect(data.target).toBeTruthy();
    expect(data.target.functionName).toBeTruthy();
  });

  test("POST /pipelines/:id/execute with valid payload returns SSE stream", async ({ request }) => {
    const res = await request.post(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          request_type: "AcknowledgeTransaction",
          update_ts: new Date().toISOString(),
          item_type: "transaction",
          rrn_seq: 0,
          create_ts: "2022-11-28T20:46:04.391183",
          ttl: 1685238364,
          client_id: "TBXPEAMOTODLP217fc564098d4e81812e49fee2425c42",
          request_sts: "FAILURE",
          record_type: "RetryItem",
          txn_json_data: "{}",
          sk: "createTs_2022-11-28T20:46:04.391183",
          pk: "txn_test_" + Date.now()
        }
      }
    });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain("text/event-stream");
  });

  test("POST /pipelines/:id/execute with empty payload returns 400", async ({ request }) => {
    const res = await request.post(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/execute`, {
      data: { item: {} }
    });
    expect(res.status()).toBe(400);
  });

  test("history accumulates runs after execution", async ({ request }) => {
    // Wait for the execution from previous test to be detected
    await new Promise(r => setTimeout(r, 15000));

    const res = await request.get(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/history`);
    const data = await res.json();
    expect(data.runs.length).toBeGreaterThan(0);

    const run = data.runs[0];
    expect(run.id).toBeTruthy();
    expect(run.timestamp).toBeTruthy();
    expect(run.status).toMatch(/^(success|error|filtered|diagnosing|pending)$/);
    expect(run.source).toMatch(/^(manual|external)$/);
  });

  test("execution with matching filter produces success run", async ({ request }) => {
    // record_type: "RetryItem" matches the filter policy
    const res = await request.post(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          request_type: "AcknowledgeTransaction",
          update_ts: new Date().toISOString(),
          item_type: "transaction",
          rrn_seq: 0,
          create_ts: "2022-11-28T20:46:04.391183",
          ttl: 1685238364,
          client_id: "TBXPEAMOTODLP217fc564098d4e81812e49fee2425c42",
          request_sts: "FAILURE",
          record_type: "RetryItem",
          txn_json_data: "{}",
          sk: "createTs_test_success",
          pk: "txn_test_success_" + Date.now()
        }
      }
    });
    expect(res.ok()).toBeTruthy();

    // Wait for pipeline to process (DynamoDB -> SNS -> SQS -> Lambda)
    await new Promise(r => setTimeout(r, 30000));

    const hist = await request.get(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/history`);
    const data = await hist.json();
    const successRun = data.runs.find((r: any) => r.status === "success");
    expect(successRun).toBeTruthy();
    expect(successRun.source).toBe("manual");
  });

  test("execution with non-matching filter produces filtered run", async ({ request }) => {
    // record_type: "PaymentRecord" does NOT match filter policy (expects "RetryItem")
    const res = await request.post(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          request_type: "AcknowledgeTransaction",
          update_ts: new Date().toISOString(),
          item_type: "transaction",
          rrn_seq: 0,
          create_ts: "2022-11-28T20:46:04.391183",
          ttl: 1685238364,
          client_id: "TBXPEAMOTODLP217fc564098d4e81812e49fee2425c42",
          request_sts: "FAILURE",
          record_type: "PaymentRecord",
          txn_json_data: "{}",
          sk: "createTs_test_filtered",
          pk: "txn_test_filtered_" + Date.now()
        }
      }
    });
    expect(res.ok()).toBeTruthy();

    // Wait for pipeline to detect the filtered event
    await new Promise(r => setTimeout(r, 30000));

    const hist = await request.get(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/history`);
    const data = await hist.json();
    const filteredRun = data.runs.find((r: any) => r.status === "filtered");
    expect(filteredRun).toBeTruthy();
  });

  test("DELETE /pipelines/:id/history clears run history", async ({ request }) => {
    const del = await request.delete(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/history`);
    expect(del.ok()).toBeTruthy();

    const after = await request.get(`http://localhost:3001/api/triggers/pipelines/${pipelineId}/history`);
    const data = await after.json();
    expect(data.runs.length).toBe(0);
  });
});

test.describe("Pipeline - UI Pages", () => {
  test("execution page loads and shows payload editor", async ({ page }) => {
    const res = await page.request.get("http://localhost:3001/api/triggers/pipelines");
    const pipelines = await res.json();
    if (!pipelines.length) return;

    await page.goto(`/triggers/${pipelines[0].id}/execute`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/execute|payload|put.*item/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("pipeline edit page loads and shows target function", async ({ page }) => {
    const res = await page.request.get("http://localhost:3001/api/triggers/pipelines");
    const pipelines = await res.json();
    if (!pipelines.length) return;

    await page.goto(`/triggers/${pipelines[0].id}/edit`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(pipelines[0].targetFunctionName)).toBeVisible({ timeout: 10000 });
  });
});
