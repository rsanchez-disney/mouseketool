import { test, expect } from "./fixtures";
import path from "path";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/sample-lambda").replace(/\\/g, "/");

test.describe("Builder Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/builder");
  });

  test("shows page title and description", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Lambda Builder" })).toBeVisible();
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
});
