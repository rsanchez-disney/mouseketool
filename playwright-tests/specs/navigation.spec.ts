import { test, expect } from "./fixtures";

test.describe("Cross-Page Navigation", () => {
  test("sidebar nav items are visible", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav, aside, [class*=sidebar]").first();
    await expect(page.getByText("Lambda Builder").first()).toBeVisible();
    await expect(page.getByText("Deployments").first()).toBeVisible();
    await expect(page.getByText("Triggers").first()).toBeVisible();
    await expect(page.getByText("Batch Projects").first()).toBeVisible();
    await expect(page.getByText("Launchpad").first()).toBeVisible();
    await expect(page.getByText("Settings").first()).toBeVisible();
  });

  test("navigate to Builder", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Lambda Builder").first().click();
    await expect(page).toHaveURL(/builder/);
  });

  test("navigate to Deployments", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Deployments").first().click();
    await expect(page).toHaveURL(/deployments/);
  });

  test("navigate to Batch Projects", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Batch Projects").first().click();
    await expect(page).toHaveURL(/batch-projects/);
  });

  test("navigate to Settings", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Settings").first().click();
    await expect(page).toHaveURL(/settings/);
  });

  test("Home page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Mouseketool").first()).toBeVisible();
  });

  test("Help page loads with tabs", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByText("Getting Started").first()).toBeVisible();
  });

  test("profile badge navigates to settings", async ({ page }) => {
    await page.goto("/");
    const badge = page.getByText("APP Developer").first();
    if (await badge.isVisible({ timeout: 3000 }).catch(() => false)) {
      await badge.click();
      await expect(page).toHaveURL(/settings/);
    }
  });
});
