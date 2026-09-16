import { defineConfig } from "@playwright/test";

const shanbayOnly = process.env.HUAYI_E2E_SUITE === "shanbay";
const eudicOnly = process.env.HUAYI_E2E_SUITE === "eudic";

const playwrightConfig = defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  testDir: "apps",
  testMatch: "**/e2e/**/*.spec.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer:
    shanbayOnly || eudicOnly
      ? undefined
      : {
          command:
            "pnpm exec vite --config apps/extension/e2e/vite.config.ts --host 127.0.0.1 --port 4173",
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
          url: "http://127.0.0.1:4173/apps/extension/e2e/fixtures/article.html",
        },
  workers: 1,
});

if (shanbayOnly || eudicOnly) {
  playwrightConfig.testMatch = shanbayOnly
    ? "**/e2e/shanbay-backfill.spec.ts"
    : "**/e2e/eudic-client.spec.ts";
}

export default playwrightConfig;
