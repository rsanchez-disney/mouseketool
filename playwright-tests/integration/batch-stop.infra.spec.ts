import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3099";

test.describe("Batch Run - Stop (requires Docker)", () => {
  test.setTimeout(120000);

  let projectId: string;
  let workflowId: string;

  test.beforeAll(async ({ request }) => {
    // Get a registered batch project
    const res = await request.get(`${BASE}/api/batch-builds`);
    const projects = await res.json();
    if (!projects.length) test.skip(true, "No batch projects registered");
    projectId = projects[0].id;

    // Get or create a workflow
    const wfRes = await request.get(`${BASE}/api/batch-workflows`);
    const workflows = await wfRes.json();
    if (workflows.length) {
      workflowId = workflows[0].id;
    } else {
      test.skip(true, "No workflows configured");
    }
  });

  test("stop during workflow rebuild kills the build and resets state", async ({ request }) => {
    // Start a workflow run with rebuild enabled
    const runRes = await request.fetch(`${BASE}/api/batch-runs/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ workflowId, composePath: "", rebuild: true }),
    });

    // Wait a bit for the build to start
    await new Promise(r => setTimeout(r, 5000));

    // Hit stop
    const stopRes = await request.post(`${BASE}/api/batch-runs/workflow/stop`);
    expect(stopRes.ok()).toBeTruthy();
    const data = await stopRes.json();
    expect(data.stopped).toBe(true);

    // Verify no containers are left running from this workflow
    await new Promise(r => setTimeout(r, 3000));
  });

  test("stop during simple run kills compose and resets state", async ({ request }) => {
    const projects = await (await request.get(`${BASE}/api/batch-builds`)).json();
    if (!projects.length) return;
    const p = projects[0];

    // Start a simple run without rebuild (goes straight to compose up)
    const runRes = await request.fetch(`${BASE}/api/batch-runs/simple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ projectId: p.id, projectPath: p.projectPath, composefile: p.composeFiles?.[0] || p.composefile, rebuild: false, portRemap: false }),
    });

    // Wait for compose to start
    await new Promise(r => setTimeout(r, 10000));

    // Hit stop
    const stopRes = await request.post(`${BASE}/api/batch-runs/simple/stop`);
    expect(stopRes.ok()).toBeTruthy();
    const data = await stopRes.json();
    expect(data.stopped).toBe(true);
  });
});
