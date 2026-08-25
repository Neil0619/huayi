import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHostedRestoreDocumentSha256 } from "./acceptance-hosted-restore-drill-contract.mjs";
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

test("controlled target-stage failure is atomically persisted before fixed failure output", async () => {
  const source = {
    contract: "huayi-hosted-restore-source-attestation/v1",
    sourceCandidateCommit: commit,
  };
  const targetIdentityDigest = "b".repeat(64);
  const events = [];
  const output = outputCapture();
  const code = await runHostedRestoreDrillCli({
    arguments_: ["execute", hostedRestoreDrillConfirmation],
    createStore: () => ({
      append: async (name, document) => {
        events.push("append");
        assert.equal(name, "failureVerification");
        assert.deepEqual(document, {
          contract: "huayi-hosted-restore-failure/v1",
          drillId: approvedPlan.drillId,
          failedAt: "2026-08-25T02:00:00.000Z",
          failedStage: "data",
          failureClass: "contract",
          sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
          sourceCandidateCommit: commit,
          targetIdentityDigest,
          toolCandidateCommit: commit,
        });
      },
      read: async () => ({
        documents: { sourceAttestation: source },
        lifecycle: "target-empty",
      }),
    }),
    externalStages: {
      execute: async () => ({
        failedAt: "2026-08-25T02:00:00.000Z",
        failedStage: "data",
        failureClass: "contract",
        outcome: "failure",
        targetIdentityDigest,
      }),
    },
    inspectRepository: async () => ({ candidateCommit: commit }),
    loadApprovedPlan: async () => approvedPlan,
    writeError: (value) => {
      events.push("stderr");
      output.writeError(value);
    },
    writeOutput: output.writeOutput,
  });
  assert.equal(code, 1);
  assert.deepEqual(events, ["append", "stderr"]);
  assert.deepEqual(output.read(), {
    stderr: "Hosted restore-drill stage failed closed.\n",
    stdout: "",
  });
});

test("every target-related external stage has a fixed controlled-failure mapping", async () => {
  const source = {
    contract: "huayi-hosted-restore-source-attestation/v1",
    sourceCandidateCommit: commit,
  };
  const targetIdentityDigest = "b".repeat(64);
  for (const scenario of [
    {
      failedStage: "target-create",
      lifecycle: "source-bound",
      stage: "target-verify-empty",
      targetIdentityDigest: null,
    },
    {
      failedStage: "target-delete",
      lifecycle: "restored-verified",
      stage: "cleanup",
      targetIdentityDigest,
    },
    {
      failedStage: "retention-close",
      lifecycle: "target-destroyed",
      stage: "retention-verify",
      targetIdentityDigest,
    },
    {
      failedStage: "retention-close",
      lifecycle: "retention-pending",
      stage: "retention-close",
      targetIdentityDigest,
    },
  ]) {
    const appended = [];
    const output = outputCapture();
    const code = await runHostedRestoreDrillCli({
      arguments_: [scenario.stage, hostedRestoreDrillConfirmation],
      createStore: () => ({
        append: async (name, document) => appended.push([name, document]),
        read: async () => ({
          documents: {
            sourceAttestation: source,
            ...(scenario.targetIdentityDigest === null
              ? {}
              : { targetEmptyVerification: { targetIdentityDigest } }),
          },
          lifecycle: scenario.lifecycle,
        }),
      }),
      externalStages: {
        [scenario.stage]: async () => ({
          failedAt: "2026-08-25T04:00:00.000Z",
          failedStage: scenario.failedStage,
          failureClass: "cleanup",
          outcome: "failure",
          targetIdentityDigest: scenario.targetIdentityDigest,
        }),
      },
      inspectRepository: async () => ({ candidateCommit: commit }),
      loadApprovedPlan: async () => approvedPlan,
      now: () =>
        new Date(
          scenario.stage === "retention-close"
            ? approvedPlan.retentionDeadline
            : "2026-08-25T04:00:00.000Z",
        ),
      ...output,
    });
    assert.equal(code, 1, scenario.stage);
    assert.equal(appended.length, 1, scenario.stage);
    assert.equal(appended[0][0], "failureVerification", scenario.stage);
    assert.equal(appended[0][1].failedStage, scenario.failedStage, scenario.stage);
    assert.deepEqual(output.read(), {
      stderr: "Hosted restore-drill stage failed closed.\n",
      stdout: "",
    });
  }
});

test("controlled failure rejects a missing or mismatched target identity before evidence write", async () => {
  for (const targetIdentityDigest of [null, "c".repeat(64)]) {
    let writes = 0;
    const output = outputCapture();
    const code = await runHostedRestoreDrillCli({
      arguments_: ["execute", hostedRestoreDrillConfirmation],
      createStore: () => ({
        append: async () => {
          writes += 1;
        },
        read: async () => ({
          documents: {
            sourceAttestation: {
              contract: "huayi-hosted-restore-source-attestation/v1",
              sourceCandidateCommit: commit,
            },
            targetEmptyVerification: { targetIdentityDigest: "b".repeat(64) },
          },
          lifecycle: "target-empty",
        }),
      }),
      externalStages: {
        execute: async () => ({
          failedAt: "2026-08-25T02:00:00.000Z",
          failedStage: "data",
          failureClass: "contract",
          outcome: "failure",
          targetIdentityDigest,
        }),
      },
      inspectRepository: async () => ({ candidateCommit: commit }),
      loadApprovedPlan: async () => approvedPlan,
      ...output,
    });
    assert.equal(code, 1);
    assert.equal(writes, 0);
  }
});

test("source failure stays outside the evidence lifecycle and result union rejects coexistence", async () => {
  for (const [stage, lifecycle, result] of [
    [
      "source-verify",
      "planned",
      {
        failedAt: "2026-08-25T00:45:00.000Z",
        failedStage: "source-verify",
        failureClass: "contract",
        outcome: "failure",
        targetIdentityDigest: null,
      },
    ],
    [
      "execute",
      "target-empty",
      {
        document: { contract: "must-not-coexist" },
        documentName: "restoreVerification",
        failedAt: "2026-08-25T02:00:00.000Z",
        failedStage: "data",
        failureClass: "contract",
        outcome: "failure",
        targetIdentityDigest: "b".repeat(64),
      },
    ],
  ]) {
    let writes = 0;
    const output = outputCapture();
    const code = await runHostedRestoreDrillCli({
      arguments_: [stage, hostedRestoreDrillConfirmation],
      createStore: () => ({
        append: async () => {
          writes += 1;
        },
        read: async () => ({
          documents:
            lifecycle === "planned"
              ? {}
              : {
                  sourceAttestation: {
                    contract: "huayi-hosted-restore-source-attestation/v1",
                    sourceCandidateCommit: commit,
                  },
                },
          lifecycle,
        }),
      }),
      externalStages: { [stage]: async () => result },
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
  }
});

test("deadline routes close target-destroyed directly and reject pre-deadline destructive work", async () => {
  const source = {
    contract: "huayi-hosted-restore-source-attestation/v1",
    sourceCandidateCommit: commit,
  };
  for (const lifecycle of ["target-destroyed", "failed-target-destroyed"]) {
    const appended = [];
    let stageRuns = 0;
    const output = outputCapture();
    const code = await runHostedRestoreDrillCli({
      arguments_: ["retention-close", hostedRestoreDrillConfirmation],
      createStore: () => ({
        append: async (name, document) => appended.push([name, document]),
        read: async () => ({ documents: { sourceAttestation: source }, lifecycle }),
      }),
      externalStages: {
        "retention-close": async () => {
          stageRuns += 1;
          return {
            document: { contract: "opaque-source-disposition" },
            documentName: "sourceDisposition",
            outcome: "success",
          };
        },
      },
      inspectRepository: async () => ({ candidateCommit: commit }),
      loadApprovedPlan: async () => approvedPlan,
      now: () => new Date(approvedPlan.retentionDeadline),
      ...output,
    });
    assert.equal(code, 0, lifecycle);
    assert.equal(stageRuns, 1, lifecycle);
    assert.deepEqual(appended, [["sourceDisposition", { contract: "opaque-source-disposition" }]]);
  }

  for (const stage of ["retention-close", "retention-verify"]) {
    let stageRuns = 0;
    const output = outputCapture();
    const code = await runHostedRestoreDrillCli({
      arguments_: [stage, hostedRestoreDrillConfirmation],
      createStore: () => ({
        append: async () => assert.fail("deadline guard must run before evidence write"),
        read: async () => ({
          documents: { sourceAttestation: source },
          lifecycle: "target-destroyed",
        }),
      }),
      externalStages: {
        [stage]: async () => {
          stageRuns += 1;
          return {
            document: {},
            documentName:
              stage === "retention-close" ? "sourceDisposition" : "sourceRetentionVerification",
            outcome: "success",
          };
        },
      },
      inspectRepository: async () => ({ candidateCommit: commit }),
      loadApprovedPlan: async () => approvedPlan,
      now: () =>
        new Date(
          stage === "retention-close" ? "2026-11-24T23:59:59.999Z" : approvedPlan.retentionDeadline,
        ),
      ...output,
    });
    assert.equal(code, 1, stage);
    assert.equal(stageRuns, 0, stage);
  }
});
