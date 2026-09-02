import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedDeepSeekProductionExecutorForCommand } from "./acceptance-hosted-deepseek-one-shot-production.mjs";
import { createHostedAcceptanceHmacKeyring } from "./acceptance-hosted-deepseek-one-shot-hmac.mjs";
import { candidateCommit } from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

const administratorPassword = "fictional-administrator-password";
const caCertificate =
  "-----BEGIN CERTIFICATE-----\nfictional-ca-material-that-is-long-enough-for-validation-0001\n-----END CERTIFICATE-----";

function productionHarness(overrides = {}) {
  const calls = [];
  const database = {
    administratorReadQuery: async () => undefined,
    close: async () => calls.push("close"),
    executorQuery: async () => undefined,
    ready: async () => calls.push("ready"),
  };
  const executor = {
    execute: async () => ({ killSwitchRestored: true, outcome: "accepted" }),
    recover: async () => ({ killSwitchRestored: true, outcome: "restored" }),
    status: async () => ({ state: "absent" }),
  };
  const keyring = createHostedAcceptanceHmacKeyring({
    activeVersion: 1,
    keys: new Map([[1, Buffer.alloc(32, 9)]]),
  });
  return {
    calls,
    dependencies: {
      createDatabase: () => {
        calls.push("database");
        return database;
      },
      createExecutor: (options) => {
        calls.push(["executor", options]);
        return executor;
      },
      createSnapshotAdapter: (options) => {
        calls.push(["snapshot-adapter", options]);
        return {
          capturePostSnapshot: () => undefined,
          capturePreSnapshot: () => undefined,
        };
      },
      createSnapshotReader: (options) => {
        calls.push(["snapshot-reader", options]);
        return {
          readPostEvidence: () => undefined,
          readPreEvidence: () => undefined,
        };
      },
      createStatusExecutor: (options) => {
        calls.push(["status-executor", options]);
        return executor;
      },
      fetchCaCertificate: async () => {
        calls.push("ca");
        return caCertificate;
      },
      loadKeyring: async (options) => {
        calls.push(["keyring", options]);
        return keyring;
      },
      readAdministratorPassword: async () => {
        calls.push("admin-password");
        return administratorPassword;
      },
      readCredential: async (name) => {
        calls.push(`credential:${name}`);
        return "fictional-vercel-personal-access-token";
      },
      readOperatorCredentials: async () => {
        calls.push("operator-credentials");
        return Object.freeze({ email: "operator@example.com", password: "fictional-password" });
      },
      ...overrides,
    },
    executor,
  };
}

test("status loads only CA and administrator Keychain material, then closes its database", async () => {
  const harness = productionHarness();
  const executor = await createHostedDeepSeekProductionExecutorForCommand({
    command: "status",
    environment: {},
    ...harness.dependencies,
  });

  assert.deepEqual(await executor.status(), { state: "absent" });
  assert.deepEqual(
    harness.calls.map((call) => (Array.isArray(call) ? call[0] : call)),
    ["ca", "admin-password", "database", "ready", "status-executor", "close"],
  );
  const statusCall = harness.calls.find(
    (call) => Array.isArray(call) && call[0] === "status-executor",
  );
  assert.equal(typeof statusCall[1].query, "function");
  assert.equal(harness.calls.includes("operator-credentials"), false);
  assert.equal(harness.calls.includes("credential:vercel-token"), false);
  assert.equal(
    harness.calls.some((call) => Array.isArray(call) && call[0] === "keyring"),
    false,
  );
});

test("execute assembles the reviewed production ports and closes them after one call", async () => {
  const harness = productionHarness();
  const executor = await createHostedDeepSeekProductionExecutorForCommand({
    command: "execute",
    environment: {},
    repositoryRoot: "/repo",
    ...harness.dependencies,
  });
  assert.deepEqual(
    await executor.execute({
      candidateCommit,
      confirmation: "--confirm-hosted-cloud-web-deepseek-one-shot-kpadiulxkgckskcfydry",
      maximumReservationMicroUsd: 50_463,
    }),
    { killSwitchRestored: true, outcome: "accepted" },
  );
  assert.equal(harness.calls.includes("credential:vercel-token"), true);
  assert.equal(harness.calls.includes("operator-credentials"), true);
  assert.equal(harness.calls.filter((call) => call === "close").length, 1);
  const executorCall = harness.calls.find((call) => Array.isArray(call) && call[0] === "executor");
  assert.equal(typeof executorCall[1].query, "function");
  assert.equal(typeof executorCall[1].keyring.create, "function");
  assert.equal(Object.keys(executorCall[1].credentials).length, 0);
  const keyringCall = harness.calls.find((call) => Array.isArray(call) && call[0] === "keyring");
  assert.deepEqual(keyringCall[1], { createIfMissing: true, environment: {} });
  assert.equal(JSON.stringify(keyringCall).includes(administratorPassword), false);
});

test("recover reads the retained keyring without deriving or replacing it", async () => {
  const harness = productionHarness({
    readAdministratorPassword: async () => "rotated-fictional-administrator-password",
  });
  const executor = await createHostedDeepSeekProductionExecutorForCommand({
    command: "recover",
    environment: {},
    repositoryRoot: "/repo",
    ...harness.dependencies,
  });

  assert.deepEqual(await executor.recover(), {
    killSwitchRestored: true,
    outcome: "restored",
  });
  const keyringCall = harness.calls.find((call) => Array.isArray(call) && call[0] === "keyring");
  assert.deepEqual(keyringCall[1], { createIfMissing: false, environment: {} });
});

test("loader rejects plaintext legacy credential environment before any I/O", async () => {
  const harness = productionHarness();
  await assert.rejects(
    createHostedDeepSeekProductionExecutorForCommand({
      command: "status",
      environment: { VERCEL_TOKEN: "forbidden" },
      ...harness.dependencies,
    }),
    /^Error: Hosted Cloud Web DeepSeek production loader failed closed\.$/u,
  );
  assert.deepEqual(harness.calls, []);
});

test("loader closes the database and creates no executor when the read-only warmup fails", async () => {
  const harness = productionHarness({
    createDatabase: () => ({
      administratorReadQuery: async () => undefined,
      close: async () => harness.calls.push("close"),
      executorQuery: async () => undefined,
      ready: async () => {
        harness.calls.push("ready");
        throw new Error("private database failure");
      },
    }),
  });
  await assert.rejects(
    createHostedDeepSeekProductionExecutorForCommand({
      command: "status",
      environment: {},
      ...harness.dependencies,
    }),
    /^Error: Hosted Cloud Web DeepSeek production loader failed closed\.$/u,
  );
  assert.equal(
    harness.calls.some((call) => Array.isArray(call) && call[0] === "status-executor"),
    false,
  );
  assert.equal(harness.calls.filter((call) => call === "close").length, 1);
});

test("package non-plan commands use the production CLI while the low-level module stays inert", async () => {
  const packageDocument = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  for (const command of ["status", "execute", "recover"]) {
    assert.equal(
      packageDocument.scripts[`acceptance:hosted:deepseek:${command}`],
      `node scripts/acceptance-hosted-deepseek-one-shot-cli.mjs ${command}`,
    );
  }
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:plan"],
    "node scripts/acceptance-hosted-deepseek-one-shot-cli.mjs plan",
  );
});
