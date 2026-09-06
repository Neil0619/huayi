import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { auditCloudRelease } from "./check-cloud-release.mjs";
import { configuration, withFixture, write } from "./cloud-release-fixture.mjs";

async function productionFixture(root) {
  const key = Buffer.alloc(162, 1).toString("base64");
  const extensionId = createHash("sha256")
    .update(Buffer.from(key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replaceAll(/[0-9a-f]/gu, (digit) => "abcdefghijklmnop"[parseInt(digit, 16)]);
  const manifest = JSON.parse(
    await readFile(join(root, "apps/store-extension/manifest.json"), "utf8"),
  );
  const productionManifest = JSON.stringify({ ...manifest, key });
  await cp(
    join(root, "apps/store-extension/dist-release"),
    join(root, "apps/store-extension/dist-production"),
    { recursive: true },
  );
  await write(root, "apps/store-extension/manifest.production.json", productionManifest);
  await write(root, "apps/store-extension/dist-production/manifest.json", productionManifest);
  const vitePath = join(root, "apps/store-extension/vite.config.ts");
  await writeFile(
    vitePath,
    (await readFile(vitePath, "utf8")).replace(
      JSON.stringify(join(root, "apps/store-extension/dist-release")),
      `(process.env.HUAYI_STORE_BUILD_PROFILE === "production" ? ${JSON.stringify(join(root, "apps/store-extension/dist-production"))} : ${JSON.stringify(join(root, "apps/store-extension/dist-release"))})`,
    ),
  );
  for (const name of ["privacy-policy", "store-listing"]) {
    await cp(
      join(root, `docs/cloud-v1/${name}.md`),
      join(root, `docs/cloud-v1/${name}-production.md`),
    );
    await write(root, `docs/cloud-v1/${name}.md`, "预发布；不可作为正式生产材料。");
  }
  return {
    ...configuration,
    apiExtensionId: extensionId,
    extensionId,
    releaseChannel: "production",
    storeBuildProfile: "production",
  };
}

test("production uses only its own complete policy and manual-package disclosure", async () => {
  await withFixture(async (root) => {
    const production = await productionFixture(root);
    assert.deepEqual(await auditCloudRelease(root, production), { ready: true, violations: [] });
    await write(root, "docs/cloud-v1/privacy-policy-production.md", "草案，备份期限待核验。");
    const result = await auditCloudRelease(root, production);
    assert.equal(result.ready, false);
    assert.ok(result.violations.some(({ code }) => code === "privacy-not-final"));
  });
});

test("production cannot borrow the acceptance policy when its own file is missing", async () => {
  await withFixture(async (root) => {
    await assert.rejects(
      auditCloudRelease(root, { ...configuration, releaseChannel: "production" }),
    );
  });
});

test("production Store and Web channels must be selected together", async () => {
  await withFixture(async (root) => {
    const production = await productionFixture(root);
    for (const override of [
      { releaseChannel: "hosted-acceptance" },
      { storeBuildProfile: "release" },
    ]) {
      const result = await auditCloudRelease(root, { ...production, ...override });
      assert.equal(result.ready, false);
      assert.ok(result.violations.some(({ code }) => code === "release-config-profile"));
    }
  });
});
