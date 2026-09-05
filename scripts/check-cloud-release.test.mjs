import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  CLOUD_DEVELOPMENT_BLOCKER_CODES,
  auditCloudDevelopmentBlockers,
  auditCloudRelease,
} from "./check-cloud-release.mjs";

const apiOrigin = "https://api.huayi.production";
const webOrigin = "https://learn.huayi.production";
const privacyUrl = `${webOrigin}/privacy`;
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const baseHosts = [
  "https://api.openai.com/*",
  "https://api.deepseek.com/*",
  "https://api.frdic.com/*",
];
const expectedFiles = [
  "brand-theme.css",
  "content-script.js",
  "manifest.json",
  "options.css",
  "options-components.css",
  "options-site-rules.css",
  "page-ui.css",
  "options.html",
  "options.js",
  "overlay.css",
  "popup.css",
  "popup.html",
  "popup.js",
  "service-worker.js",
  "youtube-content.js",
  "youtube-main.js",
];

function manifest() {
  const connectSources = [
    "https://api.openai.com",
    "https://api.deepseek.com",
    "https://api.frdic.com",
    apiOrigin,
  ].join(" ");
  return {
    action: { default_popup: "popup.html" },
    background: { service_worker: "service-worker.js", type: "module" },
    content_scripts: [
      {
        all_frames: false,
        js: ["content-script.js"],
        matches: ["http://*/*", "https://*/*"],
        run_at: "document_idle",
      },
      {
        all_frames: false,
        js: ["youtube-content.js"],
        matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
        run_at: "document_idle",
      },
      {
        all_frames: false,
        js: ["youtube-main.js"],
        matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
        run_at: "document_start",
        world: "MAIN",
      },
    ],
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${connectSources}`,
    },
    host_permissions: [...baseHosts, `${apiOrigin}/*`],
    incognito: "not_allowed",
    manifest_version: 3,
    name: "Huayi Cloud",
    options_ui: { open_in_tab: true, page: "options.html" },
    permissions: ["alarms", "storage", "unlimitedStorage"],
    version: "1.0.0",
    web_accessible_resources: [
      { matches: ["http://*/*", "https://*/*"], resources: ["overlay.css"] },
    ],
  };
}

const configuration = {
  apiExtensionId: extensionId,
  apiOrigin,
  extensionId,
  minSupportedExtensionVersion: "1.0.0",
  privacyUrl,
  storeExtensionCapability: "enabled",
  webOrigin,
};

async function write(directory, path, contents) {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "huayi-cloud-release-"));
  const storeManifest = JSON.stringify(manifest());
  await write(root, "apps/store-extension/manifest.json", storeManifest);
  for (const file of expectedFiles) {
    const contents =
      file === "manifest.json"
        ? storeManifest
        : file === "service-worker.js"
          ? `const api=${JSON.stringify(apiOrigin)};const web=${JSON.stringify(`${webOrigin}/app`)};`
          : file.endsWith(".html")
            ? '<script type="module" src="./local.js"></script>'
            : "/* packaged */";
    await write(root, `apps/store-extension/dist-release/${file}`, contents);
  }
  await write(
    root,
    "apps/store-extension/src/service-worker/service-worker.ts",
    `const HUAYI_CLOUD_API_ORIGIN: string | null = ${JSON.stringify(apiOrigin)};`,
  );
  await write(
    root,
    "apps/store-extension/src/service-worker/web-workspace-handler.ts",
    `export const HUAYI_WEB_WORKSPACE_URL: string | null = ${JSON.stringify(`${webOrigin}/app`)};`,
  );
  await write(
    root,
    "apps/web/dist/index.html",
    '<link rel="stylesheet" href="/assets/index.css"><script type="module" src="/assets/index.js"></script>',
  );
  await write(
    root,
    "apps/web/dist/assets/index.js",
    "语见 Cloud V1 隐私说明 Chrome Web Store User Data Policy Limited Use requirements",
  );
  await write(root, "apps/web/dist/assets/index.css", "body{color:#101a2d}");
  await write(
    root,
    "apps/web/vercel.json",
    JSON.stringify({ rewrites: [{ destination: "/index.html", source: "/(.*)" }] }),
  );
  await write(
    root,
    "docs/cloud-v1/privacy-policy.md",
    [
      "# 语见 Cloud V1 隐私说明",
      "Chrome Web Store User Data Policy Limited Use requirements",
      "Cloud V1 不是端到端加密产品，华译服务器可读学习内容。",
      "BYOK 与欧路凭据只保存在本机。",
      "三项账号偏好对关联设备同步；平台与 BYOK 不自动互相回退。",
      "StudyCapture 只提交原始学习意图；本机词库与 CloudWordCopy 是相互独立的副本。",
      "用户可完整账号导出，删除账号后主数据库内容在 24 小时内删除。",
      "运营主体 Huayi；联系方式 privacy@huayi.production；新加坡区域；备份保留 30 天。",
    ].join("\n"),
  );
  await write(
    root,
    "docs/cloud-v1/store-listing.md",
    [
      "# Huayi Cloud listing",
      "alarms storage unlimitedStorage",
      "api.openai.com api.deepseek.com api.frdic.com api.huayi.production",
      apiOrigin,
      webOrigin,
      privacyUrl,
      "Huayi API 账号与服务器可读 Cloud 学习内容；BYOK 凭据只在本机。",
    ].join("\n"),
  );
  return root;
}

async function withFixture(run) {
  const root = await createFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function codes(result) {
  return result.violations.map((violation) => violation.code);
}

function blockerAudit(observedCodes) {
  return auditCloudDevelopmentBlockers({
    ready: observedCodes.length === 0,
    violations: observedCodes.map((code) => ({ code, message: "untrusted diagnostic" })),
  });
}

test("development-blocked audit accepts exactly the fixed blocker set in any order", () => {
  assert.deepEqual(CLOUD_DEVELOPMENT_BLOCKER_CODES, [
    "privacy-not-final",
    "release-config-api-extension-id",
    "release-config-api-origin",
    "release-config-extension-id",
    "release-config-min-extension-version",
    "release-config-privacy-url",
    "release-config-store-capability",
    "release-config-web-origin",
    "store-api-origin",
    "store-web-workspace-url",
  ]);
  assert.deepEqual(blockerAudit([...CLOUD_DEVELOPMENT_BLOCKER_CODES].reverse()), {
    blockedAsExpected: true,
    violations: [],
  });
  assert.deepEqual(
    blockerAudit([CLOUD_DEVELOPMENT_BLOCKER_CODES[0], ...CLOUD_DEVELOPMENT_BLOCKER_CODES]),
    { blockedAsExpected: true, violations: [] },
  );
});

test("Cloud release audit refuses a Store-disabled runtime as a Store release candidate", async () => {
  await withFixture(async (root) => {
    const result = await auditCloudRelease(root, {
      ...configuration,
      storeExtensionCapability: "disabled",
    });
    assert.deepEqual(codes(result), ["release-config-store-capability"]);
  });
});

test("development-blocked audit rejects a missing blocker with a fixed safe diagnostic", () => {
  const secret = "https://candidate.example.invalid/private";
  const result = auditCloudDevelopmentBlockers({
    ready: false,
    violations: CLOUD_DEVELOPMENT_BLOCKER_CODES.slice(1).map((code) => ({
      code,
      message: secret,
    })),
  });

  assert.deepEqual(codes(result), ["development-blocker-missing"]);
  assert.equal(result.blockedAsExpected, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("development-blocked audit rejects an unexpected blocker without echoing it", () => {
  const unexpectedCode = "private-origin=https://candidate.example.invalid";
  const result = blockerAudit([...CLOUD_DEVELOPMENT_BLOCKER_CODES, unexpectedCode]);

  assert.deepEqual(codes(result), ["development-blocker-unexpected"]);
  assert.equal(result.blockedAsExpected, false);
  assert.equal(JSON.stringify(result).includes(unexpectedCode), false);
});

test("Cloud release audit accepts one self-consistent offline candidate", async () => {
  await withFixture(async (root) => {
    assert.deepEqual(await auditCloudRelease(root, configuration), {
      ready: true,
      violations: [],
    });
  });
});

test("Cloud release audit reports missing public configuration without echoing values", async () => {
  await withFixture(async (root) => {
    const result = await auditCloudRelease(root, {});
    assert.deepEqual(
      codes(result).filter((code) => code.startsWith("release-config-")),
      [
        "release-config-api-extension-id",
        "release-config-api-origin",
        "release-config-extension-id",
        "release-config-min-extension-version",
        "release-config-privacy-url",
        "release-config-store-capability",
        "release-config-web-origin",
      ],
    );
    assert.equal(JSON.stringify(result).includes(apiOrigin), false);
    assert.equal(JSON.stringify(result).includes(webOrigin), false);
  });
});

test("Cloud release audit rejects API Extension identity drift without echoing IDs", async () => {
  await withFixture(async (root) => {
    const apiExtensionId = "p".repeat(32);
    const result = await auditCloudRelease(root, { ...configuration, apiExtensionId });

    assert.deepEqual(codes(result), ["release-config-api-extension-id"]);
    assert.equal(JSON.stringify(result).includes(extensionId), false);
    assert.equal(JSON.stringify(result).includes(apiExtensionId), false);
  });
});

test("Cloud release audit rejects unsupported and malformed minimum client versions", async () => {
  await withFixture(async (root) => {
    assert.deepEqual(
      codes(
        await auditCloudRelease(root, {
          ...configuration,
          minSupportedExtensionVersion: "1.0.1",
        }),
      ),
      ["store-client-version-policy"],
    );

    for (const minSupportedExtensionVersion of ["1.0", "01.0.0", "9007199254740992.0.0"]) {
      const result = await auditCloudRelease(root, {
        ...configuration,
        minSupportedExtensionVersion,
      });
      assert.deepEqual(codes(result), ["release-config-min-extension-version"]);
      assert.equal(JSON.stringify(result).includes(minSupportedExtensionVersion), false);
    }
  });
});

test("Cloud release audit compares candidate and minimum versions as numeric triplets", async () => {
  await withFixture(async (root) => {
    const candidateManifest = { ...manifest(), version: "1.10.2" };
    const manifestText = JSON.stringify(candidateManifest);
    await write(root, "apps/store-extension/manifest.json", manifestText);
    await write(root, "apps/store-extension/dist-release/manifest.json", manifestText);

    assert.deepEqual(
      await auditCloudRelease(root, {
        ...configuration,
        minSupportedExtensionVersion: "1.9.99",
      }),
      { ready: true, violations: [] },
    );
    assert.deepEqual(
      codes(
        await auditCloudRelease(root, {
          ...configuration,
          minSupportedExtensionVersion: "1.10.3",
        }),
      ),
      ["store-client-version-policy"],
    );
  });
});

test("Cloud release audit fails closed on package, runtime, Web, policy, and disclosure drift", async () => {
  await withFixture(async (root) => {
    const unsafeManifest = manifest();
    unsafeManifest.host_permissions = baseHosts;
    unsafeManifest.content_security_policy.extension_pages =
      "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.deepseek.com https://api.frdic.com";
    const manifestText = JSON.stringify(unsafeManifest);
    await write(root, "apps/store-extension/manifest.json", manifestText);
    await write(root, "apps/store-extension/dist-release/manifest.json", manifestText);
    await write(
      root,
      "apps/store-extension/src/service-worker/service-worker.ts",
      "const HUAYI_CLOUD_API_ORIGIN: string | null = null;",
    );
    await write(
      root,
      "apps/store-extension/src/service-worker/web-workspace-handler.ts",
      'export const HUAYI_WEB_WORKSPACE_URL: string | null = "https://wrong.invalid/app";',
    );
    await write(
      root,
      "apps/store-extension/dist-release/service-worker.js",
      "/* no release origins */",
    );
    await write(
      root,
      "apps/web/dist/index.html",
      '<script src="https://remote.invalid/code.js"></script>',
    );
    await write(root, "apps/web/dist/assets/index.js", "SUPABASE_SERVICE_ROLE_KEY");
    await write(root, "docs/cloud-v1/privacy-policy.md", "草案 预发布 运营主体待补");
    await write(root, "docs/cloud-v1/store-listing.md", "无账户 无自有后端 Cloud 端到端加密");

    const result = await auditCloudRelease(root, configuration);
    assert.equal(result.ready, false);
    assert.deepEqual(
      new Set(codes(result)),
      new Set([
        "disclosure-drift",
        "phase-27-disclosure-required",
        "privacy-not-final",
        "privacy-required-facts",
        "store-api-origin",
        "store-bundle-origin",
        "store-package",
        "store-web-workspace-url",
        "web-privacy-artifact",
        "web-remote-code",
        "web-server-secret",
      ]),
    );
  });
});

test("Cloud release audit accepts equivalent account-export wording and rejects legacy Store claims", async () => {
  await withFixture(async (root) => {
    const policyPath = join(root, "docs/cloud-v1/privacy-policy.md");
    const policy = await readFile(policyPath, "utf8");
    await writeFile(policyPath, policy.replace("用户可完整账号导出", "用户可导出完整账号数据"));

    const listingPath = join(root, "docs/cloud-v1/store-listing.md");
    const listing = await readFile(listingPath, "utf8");
    await writeFile(listingPath, `${listing}\n端到端加密的本地生词本`);

    const result = await auditCloudRelease(root, configuration);
    assert.deepEqual(codes(result), ["disclosure-drift"]);
  });
});

test("Cloud release audit requires the Phase 27 preference and data-path disclosures", async () => {
  await withFixture(async (root) => {
    const policyPath = join(root, "docs/cloud-v1/privacy-policy.md");
    const policy = await readFile(policyPath, "utf8");
    await writeFile(
      policyPath,
      policy
        .replace("三项账号偏好对关联设备同步；平台与 BYOK 不自动互相回退。\n", "")
        .replace(
          "StudyCapture 只提交原始学习意图；本机词库与 CloudWordCopy 是相互独立的副本。\n",
          "",
        ),
    );

    const result = await auditCloudRelease(root, configuration);
    assert.deepEqual(codes(result), ["phase-27-disclosure-required"]);
  });
});

test("Cloud release audit rejects legacy BYOK analysis-import claims", async () => {
  await withFixture(async (root) => {
    const listingPath = join(root, "docs/cloud-v1/store-listing.md");
    const listing = await readFile(listingPath, "utf8");
    await writeFile(
      listingPath,
      `${listing}\n登录后上传 BYOK 完整结果到 /v1/analyses:import，进入 pendingReview import。`,
    );

    const result = await auditCloudRelease(root, configuration);
    assert.deepEqual(codes(result), ["phase-27-legacy-import"]);
  });
});

test("fixture helper keeps source and packaged manifests identical before mutation", async () => {
  await withFixture(async (root) => {
    assert.equal(
      await readFile(join(root, "apps/store-extension/manifest.json"), "utf8"),
      await readFile(join(root, "apps/store-extension/dist-release/manifest.json"), "utf8"),
    );
  });
});
