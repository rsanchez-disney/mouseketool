import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    // Mock GitHub-related endpoints to prevent real cloning
    await page.route("**/api/profile/clone-project", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, cloned: true }) })
    );
    await page.route("**/api/profile/github-status", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, host: "github.disney.com" }) })
    );
    await page.route("**/api/ai/status", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) })
    );
    await use(page);
  },
});

export { expect } from "@playwright/test";
