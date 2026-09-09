const apiTests = [
  "miniprogram-authentication",
  "miniprogram-binding",
  "miniprogram-data-rights",
  "miniprogram-export-app",
  "wechat-app",
  "wechat-provider",
  "miniprogram-migration",
  "word-catalog",
  "database-migration-chain",
  "miniprogram-journey",
].map((name) => `apps/api/src/${name}.test.ts`);

const webTests = [
  "app.test.tsx",
  "public-bootstrap.test.ts",
  "public-site.test.tsx",
  "privacy-page.test.tsx",
  "auth-route.test.ts",
  "app-appearance-composition.test.tsx",
  "account-settings-navigation.test.tsx",
  "wechat-binding-panel.test.tsx",
  "web-theme-contract.test.ts",
  "style-token-accessibility.test.ts",
  "styles.test.ts",
  "auth-page.test.tsx",
  "auth-page-single-flight.test.tsx",
  "password-recovery-route.test.ts",
  "password-recovery-page.test.tsx",
  "environment.test.ts",
].map((name) => `apps/web/src/${name}`);

const webSources = [
  "public-bootstrap.ts",
  "public-bootstrap.test.ts",
  "public-site.test.tsx",
  "app.tsx",
  "main.tsx",
  "public-site-shell.tsx",
  "home-page.tsx",
  "guide-page.tsx",
  "wechat-binding-panel.tsx",
  "wechat-binding-panel.test.tsx",
  "identity-api.ts",
].map((name) => `apps/web/src/${name}`);

const apiSources = [
  ...apiTests,
  ...[
    "current-database-fixture",
    "miniprogram-journey-fixture",
    "miniprogram-journey-requests",
    "miniprogram-journey-data-rights",
    "miniprogram-journey-assertions",
  ].map((name) => `apps/api/src/test-support/${name}.ts`),
];

const scripts = [
  "scripts/verify-pre-filing.mjs",
  "scripts/verify-pre-filing.test.mjs",
  "scripts/pre-filing-checks.mjs",
  "scripts/check-pre-filing-artifacts.mjs",
  "scripts/build-pre-filing-web.mjs",
  "playwright.pre-filing.config.mjs",
];
const browserSources = ["apps/web/e2e/public-site.spec.ts", "apps/web/e2e/wechat-binding.spec.ts"];
const lintSources = [
  "apps/miniprogram/src",
  ...apiSources,
  ...webSources,
  ...browserSources,
  ...scripts,
];

export function preFilingChecks(output) {
  const pnpm = (id, args, env = {}) => ({ id, executable: "pnpm", args, env });
  const tests = (id, project, paths) =>
    pnpm(id, [
      "exec",
      "vitest",
      "run",
      "--project",
      project,
      ...paths,
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${output}/${id}.json`,
    ]);
  return [
    {
      id: "runner-tests",
      executable: process.execPath,
      args: ["--test", "scripts/verify-pre-filing.test.mjs"],
    },
    tests("miniprogram-tests", "miniprogram", []),
    tests("api-tests", "api", apiTests),
    tests("web-tests", "web", webTests),
    tests("contract-tests", "cloud-contracts", [
      "packages/cloud-contracts/src/miniprogram-contracts.test.ts",
    ]),
    pnpm("format", [
      "exec",
      "prettier",
      "--check",
      ...lintSources,
      "apps/web/src/public-site.css",
      "apps/web/src/public-site-shell.css",
      "apps/web/src/public-guide.css",
      "apps/web/src/account-quota-page.css",
      "apps/api/tsconfig.json",
      "docs/cloud-v1/pre-filing-development-plan.md",
      "apps/miniprogram/README.md",
    ]),
    pnpm("lint", ["exec", "eslint", ...lintSources]),
    pnpm("types", [
      "--workspace-concurrency=1",
      "--filter",
      "@huayi/miniprogram",
      "--filter",
      "@huayi/api",
      "--filter",
      "@huayi/web",
      "typecheck",
    ]),
    pnpm("dependency-build", [
      "--filter",
      "@huayi/learning-domain",
      "--filter",
      "@huayi/cloud-contracts",
      "build",
    ]),
    pnpm("api-build", [
      "--filter",
      "@huayi/api",
      "exec",
      "tsc",
      "--project",
      "tsconfig.build.json",
      "--outDir",
      `${output}/api-dist`,
    ]),
    {
      id: "web-build",
      executable: process.execPath,
      args: ["scripts/build-pre-filing-web.mjs"],
      env: { VITE_API_ORIGIN: "https://api.huayi.invalid" },
    },
    pnpm("weapp-build", ["--filter", "@huayi/miniprogram", "build"], {
      HUAYI_MINIPROGRAM_APP_ID: "touristappid",
      HUAYI_MINIPROGRAM_API_ORIGIN: "",
    }),
    {
      id: "artifact-audit",
      executable: process.execPath,
      args: [
        "scripts/check-pre-filing-artifacts.mjs",
        `${output}/artifact-audit.json`,
        `${output}/api-dist`,
      ],
    },
    pnpm(
      "browser",
      ["exec", "playwright", "test", "--config", "playwright.pre-filing.config.mjs"],
      {
        HUAYI_PREFILING_BROWSER_OUTPUT: `${output}/browser`,
        HUAYI_PREFILING_BROWSER_REPORT: `${output}/browser.json`,
      },
    ),
  ];
}
