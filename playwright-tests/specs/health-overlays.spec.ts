import { test, expect } from "./fixtures";

test.describe("Health Overlays", () => {
  test("shows LocalStack Unavailable when health returns localstack: false", async ({ page }) => {
    // Intercept health endpoint to simulate LocalStack down
    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: false, reconciling: false }) })
    );

    await page.goto("/");
    await expect(page.getByText("LocalStack Unavailable")).toBeVisible({ timeout: 10000 });
    // Reconciling overlay should NOT be visible
    await expect(page.getByText("Restoring AWS Resources")).toBeHidden();
  });

  test("shows Restoring overlay when localstack is up and reconciling", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: true, reconciling: true }) })
    );

    await page.goto("/");
    await expect(page.getByText("Restoring AWS Resources")).toBeVisible({ timeout: 10000 });
    // LocalStack Unavailable should NOT be visible
    await expect(page.getByText("LocalStack Unavailable")).toBeHidden();
  });

  test("shows no overlay when localstack is up and not reconciling", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: true, reconciling: false }) })
    );

    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.getByText("LocalStack Unavailable")).toBeHidden();
    await expect(page.getByText("Restoring AWS Resources")).toBeHidden();
  });

  test("transitions from unavailable to reconciling when localstack comes up", async ({ page }) => {
    let lsUp = false;

    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: lsUp, reconciling: lsUp }) })
    );

    await page.goto("/");
    await expect(page.getByText("LocalStack Unavailable")).toBeVisible({ timeout: 10000 });

    // Simulate LocalStack coming up with reconciling
    lsUp = true;
    // Wait for next health poll (5s interval)
    await expect(page.getByText("Restoring AWS Resources")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("LocalStack Unavailable")).toBeHidden();
  });

  test("transitions from reconciling to normal when reconciling finishes", async ({ page }) => {
    let reconciling = true;

    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: true, reconciling }) })
    );

    await page.goto("/");
    await expect(page.getByText("Restoring AWS Resources")).toBeVisible({ timeout: 10000 });

    // Simulate reconciling done
    reconciling = false;
    // Wait for next health poll + minTime (1.5s)
    await expect(page.getByText("Restoring AWS Resources")).toBeHidden({ timeout: 10000 });
  });

  test("hides reconciling overlay on fetch error", async ({ page }) => {
    let callCount = 0;

    await page.route("**/api/health", (route) => {
      callCount++;
      if (callCount <= 1) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: true, reconciling: true }) });
      }
      return route.fulfill({ status: 500, body: "Internal Server Error" });
    });

    await page.goto("/");
    await expect(page.getByText("Restoring AWS Resources")).toBeVisible({ timeout: 10000 });

    // After error, reconciling overlay should hide and unavailable should show
    await expect(page.getByText("LocalStack Unavailable")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Restoring AWS Resources")).toBeHidden();
  });

  test("Settings page is accessible even when LocalStack is down", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", localstack: false, reconciling: false }) })
    );

    await page.goto("/settings");
    await page.waitForTimeout(1000);
    // The unavailable overlay should NOT block settings page
    await expect(page.getByText("LocalStack Unavailable")).toBeHidden();
  });
});
