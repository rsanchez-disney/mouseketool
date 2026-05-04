import { test, expect } from "./fixtures";
import path from "path";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/sample-lambda").replace(/\\/g, "/");

test.describe("Builder Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/builder");
  });

  test("shows page title and description", async ({ page }) => {
    await expect(page.getByText("Lambda Builder")).toBeVisible();
    await expect(page.getByText(/Build and deploy/i)).toBeVisible();
  });

  test("Browse button opens folder browser", async ({ page }) => {
    await page.getByRole("button", { name: /browse/i }).click();
    await page.waitForTimeout(500);
  });

  test("analyzes fixture project and shows handler", async ({ page }) => {
    const input = page.getByPlaceholder(/path/i).or(page.locator("input").first());
    await input.fill(FIXTURE_PATH);
    await input.press("Enter");
    await expect(page.getByText(/handler/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("builds fixture project with live console", async ({ page }) => {
    test.setTimeout(180000);
    const input = page.getByPlaceholder(/path/i).or(page.locator("input").first());
    await input.fill(FIXTURE_PATH);
    await input.press("Enter");
    await expect(page.getByText(/handler/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: /build project/i }).click();
    // Build console should appear
    await expect(page.getByText(/build console|running/i).first()).toBeVisible({ timeout: 10000 });
    // Wait for completion
    await expect(page.getByText(/build complete/i)).toBeVisible({ timeout: 180000 });
  });

  test("cached build visible after build", async ({ page }) => {
    await expect(page.getByText("sample-lambda").first()).toBeVisible({ timeout: 5000 });
  });

  test("deploy button available on cached build", async ({ page }) => {
    await expect(page.getByRole("button", { name: /deploy/i }).first()).toBeVisible({ timeout: 5000 });
  });
});
