import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedReleaseAttemptId,
  createHostedReleaseState,
  hostedReleaseConfirmation,
  hostedReleaseExtensionId,
  hostedReleasePhases,
  releaseIdForCandidate,
  transitionHostedReleaseState,
  validateHostedReleaseState,
} from "./acceptance-hosted-release-contract.mjs";

const candidateSha = "a".repeat(40);
const releaseAttemptId = `hosted-attempt-${"b".repeat(32)}`;

test("release identity and acceptance capability are fixed by the exact candidate", () => {
  assert.equal(releaseIdForCandidate(candidateSha), `hosted-acceptance-${candidateSha}`);
  assert.equal(hostedReleaseExtensionId, "hoijjhgcckfhbcefoclgbhkgninnkknd");
  assert.equal(hostedReleaseConfirmation, "--confirm-hosted-acceptance-release");
  assert.equal(
    createHostedReleaseAttemptId({ randomBytes_: () => Buffer.alloc(16, 0xab) }),
    `hosted-attempt-${"ab".repeat(16)}`,
  );
  assert.deepEqual(hostedReleasePhases, [
    "candidate-recorded",
    "local-quality-passed",
    "candidate-pushed",
    "ci-dispatching",
    "ci-running",
    "ci-passed",
    "api-configuring",
    "api-configured",
    "api-deploying",
    "api-running",
    "api-ready",
    "web-deploying",
    "web-running",
    "postflight",
    "complete",
  ]);
});

test("release state advances only through the fixed state machine", () => {
  const state = createHostedReleaseState({ candidateSha, now: 100, releaseAttemptId });
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.releaseAttemptId, releaseAttemptId);
  assert.equal(state.phase, "candidate-recorded");
  const local = transitionHostedReleaseState(state, {
    now: 101,
    phase: "local-quality-passed",
  });
  const pushed = transitionHostedReleaseState(local, {
    now: 102,
    phase: "candidate-pushed",
  });
  assert.equal(validateHostedReleaseState(pushed).phase, "candidate-pushed");
  assert.throws(
    () => transitionHostedReleaseState(state, { now: 101, phase: "ci-passed" }),
    /^Error: Hosted acceptance release state failed closed\.$/u,
  );
});

test("release state rejects unknown fields, secrets, and invalid stage evidence", () => {
  const state = createHostedReleaseState({ candidateSha, now: 100, releaseAttemptId });
  for (const invalid of [
    { ...state, token: "private" },
    { ...state, candidateSha: "bad" },
    { ...state, releaseAttemptId: `hosted-attempt-${"z".repeat(32)}` },
    { ...state, ciRunId: 123 },
    { ...state, apiDeploymentId: "dpl_private" },
    { ...state, phase: "complete" },
  ]) {
    assert.throws(
      () => validateHostedReleaseState(invalid),
      /^Error: Hosted acceptance release state failed closed\.$/u,
    );
  }
});

test("release state preserves read compatibility for a legacy schema-v1 completion", () => {
  const legacy = {
    apiDeploymentId: "dpl_api_legacy_123",
    branch: "codex/settings-configuration",
    candidateSha,
    ciRunId: 42,
    createdAt: 100,
    phase: "complete",
    releaseId: `hosted-acceptance-${candidateSha}`,
    schemaVersion: 1,
    updatedAt: 200,
    webDeploymentId: "dpl_web_legacy_123",
  };

  assert.deepEqual(validateHostedReleaseState(legacy), legacy);
});
