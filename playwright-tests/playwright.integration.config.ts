import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./integration",
  timeout: 180000,
  retries: 0,
  workers: 1, // Serial execution - pipeline tests depend on order
  use: {
    baseURL: "http://localhost:3099",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  // No webServer - the tests manage their own backend instance
});
