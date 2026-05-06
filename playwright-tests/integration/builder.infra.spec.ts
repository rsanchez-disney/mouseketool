import { test, expect } from "@playwright/test";
import path from "path";

const BASE = "http://localhost:3099";
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/sample-lambda").replace(/\\/g, "/");

test.describe("Builder - Full Build (requires Maven)", () => {
  test.setTimeout(180000);

  test("builds fixture project with live console", async ({ page }) => {
    await page.goto(`${BASE}/builder`);
    const input = page.getByPlaceholder(/path/i).or(page.locator("input").first());
    await input.fill(FIXTURE_PATH);
    await input.press("Enter");
    await expect(page.getByText(/handler/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: /build project/i }).click();
    await expect(page.getByText(/build console|running/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/build complete/i)).toBeVisible({ timeout: 180000 });
  });

  test("cached build visible after build", async ({ page }) => {
    await page.goto(`${BASE}/builder`);
    await expect(page.getByText("sample-lambda").first()).toBeVisible({ timeout: 5000 });
  });

  test("deploy button available on cached build", async ({ page }) => {
    await page.goto(`${BASE}/builder`);
    await expect(page.getByRole("button", { name: /deploy/i }).first()).toBeVisible({ timeout: 5000 });
  });
});
