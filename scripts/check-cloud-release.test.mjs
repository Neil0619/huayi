import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  CLOUD_DEVELOPMENT_BLOCKER_CODES,
  auditCloudDevelopmentBlockers,
  auditCloudRelease,
} from "./check-cloud-release.mjs";

import {
  apiOrigin,
  baseHosts,
  webOrigin,
  extensionId,
  configuration,
  manifest,
  withFixture,
  write,
} from "./cloud-release-fixture.mjs";

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

test("Cloud release audit validates compiled profile exports instead of merely trusting build defines", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/store-extension/src/service-worker/cloud-build-profile.ts",
      "export const HUAYI_CLOUD_API_ORIGIN = null; export const HUAYI_WEB_WORKSPACE_URL = null; export const HUAYI_WEB_ORIGIN = null;",
    );
    const result = await auditCloudRelease(root, configuration);
    assert.deepEqual(codes(result), ["store-api-origin", "store-web-workspace-url"]);
  });
});

test("Cloud release audit rejects unused profile values even when the package contains the expected URLs", async () => {
  await withFixture(async (root) => {
    await write(
      root,
      "apps/store-extension/src/service-worker/service-worker.ts",
      'import * as profile from "./cloud-build-profile.js"; createProductionCloudClients(null); handleOpenWebWorkspace(message, sender, runtime, null);',
    );
    assert.deepEqual(codes(await auditCloudRelease(root, configuration)), [
      "store-api-origin",
      "store-web-workspace-url",
    ]);
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

test("Cloud release audit inspects the selected production profile from the candidate checkout", async () => {
  await withFixture(async (root) => {
    for (const name of ["privacy-policy", "store-listing"]) {
      await write(
        root,
        `docs/cloud-v1/${name}-production.md`,
        await readFile(join(root, `docs/cloud-v1/${name}.md`), "utf8"),
      );
    }
    await write(
      root,
      "apps/web/vercel.mjs",
      [
        'if (process.env.VITE_DEPLOYMENT_ENVIRONMENT !== "production") throw new Error("wrong profile");',
        'export const config = { rewrites: [{ source: "/(.*)", destination: "/index.html" }] };',
      ].join("\n"),
    );
    assert.deepEqual(
      codes(await auditCloudRelease(root, { ...configuration, releaseChannel: "production" })),
      ["release-config-profile"],
    );
    await assert.rejects(
      auditCloudRelease(root, { ...configuration, releaseChannel: "hosted-acceptance" }),
      { message: "Web deployment configuration is invalid." },
    );
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
