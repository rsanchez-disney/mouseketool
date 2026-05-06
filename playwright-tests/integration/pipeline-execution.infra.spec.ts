import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3099";

test.describe("Pipeline Execution (requires LocalStack)", () => {
  test.setTimeout(90000);
  let pipelineId: string;

  test.beforeAll(async ({ request }) => {
    // Get first pipeline from the backend
    const res = await request.get(`${BASE}/api/triggers/pipelines`);
    const data = await res.json();
    pipelineId = data[0]?.id;
    test.skip(!pipelineId, "No pipelines configured");
  });

  test("execution with matching filter produces success run", async ({ request }) => {
    const res = await request.post(`${BASE}/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          request_type: "AcknowledgeTransaction",
          update_ts: new Date().toISOString(),
          item_type: "transaction",
          rrn_seq: 0,
          create_ts: "2022-11-28T20:46:04.391183",
          ttl: 1685238364,
          client_id: "TEST_CLIENT",
          request_sts: "FAILURE",
          record_type: "RetryItem",
          txn_json_data: "{}",
          sk: "createTs_test_success",
          pk: "txn_test_success_" + Date.now()
        }
      }
    });
    expect(res.ok()).toBeTruthy();

    await new Promise(r => setTimeout(r, 30000));

    const hist = await request.get(`${BASE}/api/triggers/pipelines/${pipelineId}/history`);
    const data = await hist.json();
    const successRun = data.runs.find((r: any) => r.status === "success");
    expect(successRun).toBeTruthy();
    expect(successRun.source).toBe("manual");
  });

  test("execution with non-matching filter produces filtered run", async ({ request }) => {
    const res = await request.post(`${BASE}/api/triggers/pipelines/${pipelineId}/execute`, {
      data: {
        item: {
          request_type: "AcknowledgeTransaction",
          update_ts: new Date().toISOString(),
          item_type: "transaction",
          rrn_seq: 0,
          create_ts: "2022-11-28T20:46:04.391183",
          ttl: 1685238364,
          client_id: "TEST_CLIENT",
          request_sts: "FAILURE",
          record_type: "PaymentRecord",
          txn_json_data: "{}",
          sk: "createTs_test_filtered",
          pk: "txn_test_filtered_" + Date.now()
        }
      }
    });
    expect(res.ok()).toBeTruthy();

    await new Promise(r => setTimeout(r, 30000));

    const hist = await request.get(`${BASE}/api/triggers/pipelines/${pipelineId}/history`);
    const data = await hist.json();
    const filteredRun = data.runs.find((r: any) => r.status === "filtered");
    expect(filteredRun).toBeTruthy();
  });
});
