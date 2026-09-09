import { defineConfig } from "@playwright/test";

// The specs fulfill local dist assets themselves. No server or external API is started.
export default defineConfig({
  testDir: "apps/web/e2e",
  testMatch: ["public-site.spec.ts", "privacy-layout.spec.ts", "wechat-binding.spec.ts"],
  outputDir: process.env.HUAYI_PREFILING_BROWSER_OUTPUT ?? "artifacts/pre-filing-browser",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.HUAYI_PREFILING_BROWSER_REPORT ?? "artifacts/pre-filing-browser-report.json",
      },
    ],
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { browserName: "chromium", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
