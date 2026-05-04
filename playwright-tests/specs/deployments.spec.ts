import { test, expect } from "./fixtures";

test.describe("Deployments Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/deployments");
  });

  test("shows deployed Lambda cards", async ({ page }) => {
    await expect(page.getByRole("button", { name: /invoke/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test("clicking Invoke opens invoke panel", async ({ page }) => {
    await page.getByRole("button", { name: "Invoke" }).first().click();
    // Should show payload area
    await expect(page.getByText(/payload/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("invoke Lambda with valid payload", async ({ page }) => {
    test.setTimeout(60000);
    await page.getByRole("button", { name: "Invoke" }).first().click();
    await page.waitForTimeout(500);

    // Find the payload editor - could be textarea or contenteditable
    const editor = page.locator("textarea").first();
    if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editor.fill('{"test": "hello"}');
    }

    // Click the invoke/run button in the invoke panel
    await page.getByRole("button", { name: /invoke|run/i }).last().click();

    // Wait for response
    await expect(page.getByText(/200|statusCode|response/i).first()).toBeVisible({ timeout: 30000 });
  });

  test("shows function details", async ({ page }) => {
    await expect(page.getByText(/java21/).first()).toBeVisible();
    await expect(page.getByText(/maven/).first()).toBeVisible();
    await expect(page.getByText(/2048/).first()).toBeVisible();
  });

  test("search filters deployments", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);
    await search.fill("retry");
    await expect(page.getByText("wdpr-app-retry-handler")).toBeVisible();
    await expect(page.getByText("wdpr-app-dlp-payment-stream-handler")).not.toBeVisible();
  });

  test("Refresh button works", async ({ page }) => {
    await page.getByRole("button", { name: /refresh/i }).click();
    await expect(page.getByRole("button", { name: /invoke/i }).first()).toBeVisible({ timeout: 10000 });
  });
});
