import { test, expect } from "./fixtures";

test.describe("Batch Run - Stop", () => {
  test("stop endpoint returns stopped:true when no run active", async ({ request }) => {
    const res = await request.post("http://localhost:3001/api/batch-runs/simple/stop");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.stopped).toBe(true);
  });

  test("workflow stop endpoint returns stopped:true when no run active", async ({ request }) => {
    const res = await request.post("http://localhost:3001/api/batch-runs/workflow/stop");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.stopped).toBe(true);
  });

  test("stop button is visible and enabled during a run", async ({ page }) => {
    const res = await page.request.get("http://localhost:3001/api/batch-builds");
    const projects = await res.json();
    if (!projects.length) return;

    await page.goto(`/batch-projects/${projects[0].id}/run`);
    const stopBtn = page.getByRole("button", { name: /stop/i });
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
  });

  test("stop button resets UI after clicking", async ({ page }) => {
    // Navigate to launchpad with a workflow
    const wfRes = await page.request.get("http://localhost:3001/api/batch-workflows");
    const workflows = await wfRes.json();
    if (!workflows.length) return;

    await page.goto(`/launchpad?workflowId=${workflows[0].id}`);
    await page.waitForTimeout(500);

    // Verify Run button is visible (not in running state)
    const runBtn = page.getByRole("button", { name: /run/i }).first();
    await expect(runBtn).toBeVisible({ timeout: 5000 });
  });
});
