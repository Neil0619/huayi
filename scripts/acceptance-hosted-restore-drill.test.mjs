import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedRestoreDrillConfirmation,
  runHostedRestoreDrillCli,
} from "./acceptance-hosted-restore-drill.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const approvedPlan = {
  approvalReference: "approval.phase87.test",
  approvedAt: "2026-08-25T00:30:00.000Z",
  contract: "huayi-hosted-restore-approved-plan/v1",
  coverageProfile: "reviewed-production-coverage/v1",
  coverageReportSha256: "a".repeat(64),
  drillId: "seen-said-recovery-2026-q3-0123456789abcdef",
  dumpBytes: 1024,
  dumpSha256: "a".repeat(64),
  manifestSha256: "a".repeat(64),
  migrationHead: "20260824010000",
  postgresMajor: "17",
  retentionDeadline: "2026-11-25T00:00:00.000Z",
  retentionPolicyVersion: "production-backup-retention/v1",
  sourceCandidateCommit: commit,
  sourceCapturedAt: "2026-08-25T00:00:00.000Z",
  sourceProjectIdentityDigest: "a".repeat(64),
  storageExportManifestSha256: null,
  storageObjectBytesMode: "source-empty",
  targetRegion: "ap-southeast-1",
  tocAllowlistSha256: "a".repeat(64),
  toolCandidateCommit: commit,
};

function outputCapture() {
  let stderr = "";
  let stdout = "";
  return {
    read: () => ({ stderr, stdout }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  };
}

test("plan is zero dependency and invalid arguments fail before approved-plan loading", async () => {
  for (const arguments_ of [["plan"], ["execute"], ["unknown", hostedRestoreDrillConfirmation]]) {
    const output = outputCapture();
    let loads = 0;
    const code = await runHostedRestoreDrillCli({
      arguments_,
      loadApprovedPlan: async () => {
        loads += 1;
        throw new Error("must not load");
      },
      ...output,
    });
    assert.equal(loads, 0);
    assert.equal(code, arguments_[0] === "plan" ? 0 : 1);
    assert.equal(output.read().stdout.includes("zero filesystem"), arguments_[0] === "plan");
  }
});

test("explicit controlled stage persists only its expected strict document", async () => {
  const appended = [];
  const output = outputCapture();
  const document = { contract: "opaque-test-document" };
  const code = await runHostedRestoreDrillCli({
    arguments_: ["source-verify", hostedRestoreDrillConfirmation],
    createStore: () => ({
      append: async (name, value) => appended.push([name, value]),
      read: async () => ({ documents: {}, lifecycle: "planned" }),
    }),
    externalStages: {
      "source-verify": async ({ expected, lifecycle }) => {
        assert.deepEqual(expected, approvedPlan);
        assert.equal(lifecycle, "planned");
        return { document, documentName: "sourceAttestation", outcome: "success" };
      },
    },
    inspectRepository: async () => ({ candidateCommit: commit }),
    loadApprovedPlan: async () => approvedPlan,
    ...output,
  });
  assert.equal(code, 0);
  assert.deepEqual(appended, [["sourceAttestation", document]]);
  assert.deepEqual(output.read(), {
    stderr: "",
    stdout: "Hosted restore-drill stage passed: source-verify.\n",
  });
});

test("verify succeeds only for restored-verified strict evidence", async () => {
  for (const [lifecycle, expectedCode] of [
    ["planned", 1],
    ["source-bound", 1],
    ["target-empty", 1],
    ["restored-verified", 0],
    ["target-destroyed", 1],
    ["retention-pending", 1],
    ["closed", 1],
    ["failed-cleanup-pending", 1],
    ["failed-target-destroyed", 1],
    ["failed-cleaned-retention-pending", 1],
    ["failed-closed", 1],
  ]) {
    const output = outputCapture();
    const code = await runHostedRestoreDrillCli({
      arguments_: ["verify", hostedRestoreDrillConfirmation],
      createStore: () => ({
        append: async () => assert.fail("verify must never write"),
        read: async () => ({ documents: {}, lifecycle }),
      }),
      inspectRepository: async () => ({ candidateCommit: commit }),
      loadApprovedPlan: async () => approvedPlan,
      ...output,
    });
    assert.equal(code, expectedCode, lifecycle);
    assert.deepEqual(
      output.read(),
      expectedCode === 0
        ? {
            stderr: "",
            stdout: "Hosted restore-drill lifecycle verified: restored-verified.\n",
          }
        : { stderr: "Hosted restore-drill stage failed closed.\n", stdout: "" },
      lifecycle,
    );
  }
});

test("missing external adapter fails closed without appending evidence", async () => {
  let writes = 0;
  const output = outputCapture();
  const code = await runHostedRestoreDrillCli({
    arguments_: ["execute", hostedRestoreDrillConfirmation],
    createStore: () => ({
      append: async () => {
        writes += 1;
      },
      read: async () => ({ documents: {}, lifecycle: "target-empty" }),
    }),
    inspectRepository: async () => ({ candidateCommit: commit }),
    loadApprovedPlan: async () => approvedPlan,
    ...output,
  });
  assert.equal(code, 1);
  assert.equal(writes, 0);
  assert.deepEqual(output.read(), {
    stderr: "Hosted restore-drill stage failed closed.\n",
    stdout: "",
  });
});

test("candidate mismatch fails before evidence or external stage access", async () => {
  let storeCreated = false;
  let stageRuns = 0;
  const output = outputCapture();
  const code = await runHostedRestoreDrillCli({
    arguments_: ["source-verify", hostedRestoreDrillConfirmation],
    createStore: () => {
      storeCreated = true;
      throw new Error("must not create");
    },
    externalStages: {
      "source-verify": async () => {
        stageRuns += 1;
      },
    },
    inspectRepository: async () => ({ candidateCommit: "f".repeat(40) }),
    loadApprovedPlan: async () => approvedPlan,
    ...output,
  });
  assert.equal(code, 1);
  assert.equal(storeCreated, false);
  assert.equal(stageRuns, 0);
  assert.equal(output.read().stderr, "Hosted restore-drill stage failed closed.\n");
});

test("package exposes only fixed restore-drill control-plane arguments", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const expected = {
    "acceptance:hosted:restore:cleanup": `node scripts/acceptance-hosted-restore-drill.mjs cleanup ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:execute": `node scripts/acceptance-hosted-restore-drill.mjs execute ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:plan": "node scripts/acceptance-hosted-restore-drill.mjs plan",
    "acceptance:hosted:restore:retention:close": `node scripts/acceptance-hosted-restore-drill.mjs retention-close ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:retention:verify": `node scripts/acceptance-hosted-restore-drill.mjs retention-verify ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:source:verify": `node scripts/acceptance-hosted-restore-drill.mjs source-verify ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:status": `node scripts/acceptance-hosted-restore-drill.mjs status ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:target:verify-empty": `node scripts/acceptance-hosted-restore-drill.mjs target-verify-empty ${hostedRestoreDrillConfirmation}`,
    "acceptance:hosted:restore:verify": `node scripts/acceptance-hosted-restore-drill.mjs verify ${hostedRestoreDrillConfirmation}`,
  };
  for (const [name, command] of Object.entries(expected)) {
    assert.equal(packageDocument.scripts[name], command);
  }
});
