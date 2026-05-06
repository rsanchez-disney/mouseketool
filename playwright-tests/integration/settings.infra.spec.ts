import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3099";

test.describe("Settings - Managed LocalStack (requires Docker)", () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${BASE}/api/settings`, { data: { localstackManaged: true } });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${BASE}/api/settings`, { data: { localstackManaged: false } });
  });

  test("shows LocalStack container info", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await expect(page.getByText("mouseketool-localstack")).toBeVisible({ timeout: 10000 });
  });

  test("Start or Stop button available", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    const startBtn = page.getByRole("button", { name: /start/i });
    const stopBtn = page.getByRole("button", { name: /stop/i });
    await expect(startBtn.or(stopBtn)).toBeVisible({ timeout: 10000 });
  });
});
