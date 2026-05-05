import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  testDir: "./specs",
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: [
    { command: "cd ../backend && npm run dev", port: 3001, reuseExistingServer: true },
    { command: "cd ../frontend && npm run dev", port: 5173, reuseExistingServer: true },
  ],
});
