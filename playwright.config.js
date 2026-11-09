import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const chrome =
  process.env.CP_TEST_BROWSER_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL(
  "./tests/.runtime/browsers",
  import.meta.url,
).pathname;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.CP_TEST_PORT || 8878}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
  },
  projects: [
    { name: "api", testMatch: "integration/**/*.spec.js" },
    {
      name: "chromium",
      testMatch: "e2e/**/*.spec.js",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: "e2e/**/*.spec.js",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node tests/support/serve.mjs",
    url: `http://127.0.0.1:${process.env.CP_TEST_PORT || 8878}/health`,
    reuseExistingServer: false,
  },
});
