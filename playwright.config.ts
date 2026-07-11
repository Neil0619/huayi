import { defineConfig } from "@playwright/test";

const playwrightConfig = defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  testDir: "apps/extension/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:4173/apps/extension/e2e/fixtures/article.html",
  },
  workers: 1,
});

export default playwrightConfig;
