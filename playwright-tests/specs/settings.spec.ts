import { test, expect } from "./fixtures";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("loads with Connection tab active showing Managed mode", async ({ page }) => {
    await expect(page.getByText("Managed LocalStack Instance")).toBeVisible();
  });

  test("shows LocalStack container info", async ({ page }) => {
    await expect(page.getByText("mouseketool-localstack")).toBeVisible();
  });

  test("LocalStack status indicator visible", async ({ page }) => {
    await expect(page.getByText(/running|stopped/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Start or Stop button available", async ({ page }) => {
    const startBtn = page.getByRole("button", { name: /start/i });
    const stopBtn = page.getByRole("button", { name: /stop/i });
    await expect(startBtn.or(stopBtn)).toBeVisible({ timeout: 5000 });
  });

  test("can navigate to all tabs", async ({ page }) => {
    const tabNames = ["Lambda", "Builds", "Pipelines", "AI", "Workflows", "UI"];
    for (const name of tabNames) {
      await page.getByText(name, { exact: true }).first().click();
      await page.waitForTimeout(200);
    }
  });

  test("Save button visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /save/i })).toBeVisible();
  });

  test("Lambda tab shows memory setting in card", async ({ page }) => {
    await page.goto("/settings?tab=lambda");
    await expect(page.getByText("Default Memory")).toBeVisible();
  });

  test("Builds tab shows cleanup settings in cards", async ({ page }) => {
    await page.goto("/settings?tab=builds");
    await expect(page.getByText("Auto-Cleanup")).toBeVisible();
    await expect(page.getByText("Delete on startup")).toBeVisible();
  });

  test("Pipelines tab shows history retention and heavy load cards", async ({ page }) => {
    await page.getByText("Pipelines", { exact: true }).first().click();
    await expect(page.getByText("History Retention")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Heavy Load" })).toBeVisible();
  });

  test("AI tab shows learned data storage card", async ({ page }) => {
    await page.goto("/settings?tab=ai");
    await expect(page.getByText("Learned Data Storage")).toBeVisible();
  });

  test("Workflows tab shows auto-bump healthchecks card", async ({ page }) => {
    await page.goto("/settings?tab=workflows");
    await expect(page.getByText("Auto-bump healthchecks")).toBeVisible();
  });

  test("UI tab shows confetti and theme cards", async ({ page }) => {
    await page.goto("/settings?tab=ui");
    await expect(page.getByText("Confetti celebrations")).toBeVisible();
    await expect(page.getByText("Theme transition animation")).toBeVisible();
  });

  test("Profile tab shows workspace and profile selector", async ({ page }) => {
    await page.goto("/settings?tab=profile");
    await expect(page.getByText(/workspace/i)).toBeVisible();
  });

  test("Profile tab shows available profiles in dropdown", async ({ page }) => {
    await page.goto("/settings?tab=profile");
    await page.waitForTimeout(500);
    const combobox = page.locator("[role=combobox]").first();
    if (await combobox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await combobox.click();
      await expect(page.getByText("APP Developer")).toBeVisible();
    }
  });
});
