import { test, expect } from "./fixtures";
import path from "path";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/sample-lambda").replace(/\\/g, "/");

test.describe("Deployments Page", () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Check if any Lambdas are deployed
    const res = await page.request.get("http://localhost:3001/api/deployments");
    const deps = await res.json();
    if (!deps.length) {
      // Build and deploy fixture
      const buildRes = await page.request.post("http://localhost:3001/api/builds/sync", { data: { projectPath: FIXTURE_PATH, freshClone: false } });
      const build = await buildRes.json();
      if (build.buildId) {
        await page.request.post("http://localhost:3001/api/deploy", { data: { buildId: build.buildId, handler: build.handler || "com.test.Handler::handleRequest", functionName: "test-lambda", runtime: "java21" } });
      }
    }
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/deployments");
  });

  test("shows deployed Lambda cards", async ({ page }) => {
    await expect(page.getByRole("button", { name: /invoke/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test("clicking Invoke opens invoke panel", async ({ page }) => {
    await page.getByRole("button", { name: "Invoke" }).first().click();
    await expect(page.getByText(/payload/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("invoke Lambda with valid payload", async ({ page }) => {
    test.setTimeout(60000);
    await page.getByRole("button", { name: "Invoke" }).first().click();
    await page.waitForTimeout(500);

    const editor = page.locator("textarea").first();
    if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editor.fill('{"test": "hello"}');
    }

    await page.getByRole("button", { name: /invoke|run/i }).last().click();
    await expect(page.getByText(/200|statusCode|response/i).first()).toBeVisible({ timeout: 30000 });
  });

  test("shows function details", async ({ page }) => {
    await expect(page.getByText(/java21/).first()).toBeVisible();
    await expect(page.getByText(/maven/).first()).toBeVisible();
    await expect(page.getByText(/2048/).first()).toBeVisible();
  });

  test("search filters deployments", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);
    await search.fill("test-lambda");
    await expect(page.getByText("test-lambda").first()).toBeVisible();
  });

  test("Refresh button works", async ({ page }) => {
    await page.getByRole("button", { name: /refresh/i }).click();
    await expect(page.getByRole("button", { name: /invoke/i }).first()).toBeVisible({ timeout: 10000 });
  });
});
