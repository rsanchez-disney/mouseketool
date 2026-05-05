import { test, expect } from "./fixtures";

test.describe("Batch Run Page", () => {
  test("batch projects page shows registered projects", async ({ page }) => {
    await page.goto("/batch-projects");
    await expect(page.getByText(/project/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("shows Run Settings and Project Info panels", async ({ page }) => {
    const res = await page.request.get("http://localhost:3001/api/batch-builds");
    const projects = await res.json();
    if (!projects.length) return;

    await page.goto(`/batch-projects/${projects[0].id}/run`);
    await expect(page.getByText("Run Settings")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Project Info")).toBeVisible();
    await expect(page.getByText("Rebuild image")).toBeVisible();
    await expect(page.getByText("Port remapping")).toBeVisible();
  });

  test("shows compose file selector and Run button", async ({ page }) => {
    const res = await page.request.get("http://localhost:3001/api/batch-builds");
    const projects = await res.json();
    if (!projects.length) return;

    await page.goto(`/batch-projects/${projects[0].id}/run`);
    await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible({ timeout: 5000 });
  });
});
