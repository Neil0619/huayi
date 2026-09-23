import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";

import { productionStoreExtensionId, runProductionStoreCli } from "./production-store-build.mjs";

test("production build selects a fixed profile without passing credentials and then audits the result", async () => {
  const events = [];
  const code = await runProductionStoreCli({
    arguments_: ["build"],
    repositoryRoot: "/repo",
    environment: {
      npm_execpath: "/pnpm.cjs",
      HUAYI_STORE_BUILD_PROFILE: "hosted-acceptance",
      VERCEL_TOKEN: "fictional-secret",
    },
    runBuild: async (request) => {
      events.push(request);
      return true;
    },
    audit: async (root) => {
      events.push(root);
      return [];
    },
    writeOutput: (text) => events.push(text),
  });
  assert.equal(code, 0);
  assert.equal(events[0].environment.HUAYI_STORE_BUILD_PROFILE, "production");
  assert.equal(events[0].environment.npm_execpath, "/pnpm.cjs");
  assert.equal(JSON.stringify(events).includes("fictional-secret"), false);
  assert.equal(events[1], "/repo");
  assert.equal(productionStoreExtensionId, "kehpghgppccjlmahanlmeagnpnfbcnea");
});

test("production status cannot build and audit failures are not reported as ready", async () => {
  const output = [];
  assert.equal(
    await runProductionStoreCli({
      arguments_: ["status"],
      runBuild: async () => assert.fail("status must not build"),
      audit: async () => ["private failure detail"],
      writeOutput: (value) => output.push(value),
      writeError: (value) => output.push(value),
    }),
    1,
  );
  assert.deepEqual(output, ["Production Store package failed verification.\n"]);
});

test("a failed production build never runs the package audit or claims readiness", async () => {
  const output = [];
  assert.equal(
    await runProductionStoreCli({
      arguments_: ["build"],
      environment: {},
      runBuild: async () => false,
      audit: async () => assert.fail("failed build cannot be audited as ready"),
      writeOutput: (value) => output.push(value),
      writeError: (value) => output.push(value),
    }),
    1,
  );
  assert.deepEqual(output, ["Production Store package failed verification.\n"]);
});

test("production source binds the existing Chrome Web Store item and increments its uploaded version", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../apps/store-extension/manifest.production.json", import.meta.url),
      "utf8",
    ),
  );
  const key = Buffer.from(manifest.key, "base64");
  assert.equal(key.toString("base64"), manifest.key);
  const publicKey = createPublicKey({ key, format: "der", type: "spki" });
  assert.equal(publicKey.asymmetricKeyType, "rsa");
  assert.deepEqual(publicKey.export({ format: "der", type: "spki" }), key);
  const id = createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 32)
    .replaceAll(/[0-9a-f]/gu, (digit) => "abcdefghijklmnop"[parseInt(digit, 16)]);
  assert.equal(id, "kehpghgppccjlmahanlmeagnpnfbcnea");
  assert.equal(productionStoreExtensionId, id);
  assert.equal(manifest.version, "1.0.2");

  const hosted = JSON.parse(
    await readFile(
      new URL("../apps/store-extension/manifest.hosted-acceptance.json", import.meta.url),
      "utf8",
    ),
  );
  const hostedId = createHash("sha256")
    .update(Buffer.from(hosted.key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replaceAll(/[0-9a-f]/gu, (digit) => "abcdefghijklmnop"[parseInt(digit, 16)]);
  assert.equal(hostedId, "hoijjhgcckfhbcefoclgbhkgninnkknd");
  assert.equal(hosted.version, "1.0.0");
});
