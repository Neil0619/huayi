import { randomBytes } from "node:crypto";

export const hostedReleaseConfirmation = "--confirm-hosted-acceptance-release";
export const hostedReleaseExtensionId = "hoijjhgcckfhbcefoclgbhkgninnkknd";
export const hostedReleaseBranch = "codex/settings-configuration";
export const hostedReleasePhases = Object.freeze([
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

const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;
const releaseAttemptPattern = /^hosted-attempt-[0-9a-f]{32}$/u;
const stateV1Keys = Object.freeze([
  "apiDeploymentId",
  "branch",
  "candidateSha",
  "ciRunId",
  "createdAt",
  "phase",
  "releaseId",
  "schemaVersion",
  "updatedAt",
  "webDeploymentId",
]);
const stateV2Keys = Object.freeze([...stateV1Keys, "releaseAttemptId"]);
const stateV3Keys = Object.freeze([...stateV2Keys, "provenance"]);
const ordinaryReleaseProvenance = "ordinary-release";
export const hostedCronBootstrapReleaseProvenance = "cron-bootstrap-provision";

function fail() {
  throw new Error("Hosted acceptance release state failed closed.");
}

export function releaseIdForCandidate(candidateSha) {
  if (typeof candidateSha !== "string" || !commitPattern.test(candidateSha)) fail();
  return `hosted-acceptance-${candidateSha}`;
}

export function createHostedReleaseAttemptId({ randomBytes_ = randomBytes } = {}) {
  try {
    if (typeof randomBytes_ !== "function") fail();
    const entropy = randomBytes_(16);
    if (!Buffer.isBuffer(entropy) || entropy.length !== 16) fail();
    return `hosted-attempt-${entropy.toString("hex")}`;
  } catch {
    fail();
  }
}

export function validHostedReleaseAttemptId(value) {
  return typeof value === "string" && releaseAttemptPattern.test(value);
}

function evidenceIsValid(state, phaseIndex) {
  const ciRequired = phaseIndex >= hostedReleasePhases.indexOf("ci-running");
  const apiRequired = phaseIndex >= hostedReleasePhases.indexOf("api-running");
  const webRequired = phaseIndex >= hostedReleasePhases.indexOf("web-running");
  return (
    (ciRequired
      ? Number.isSafeInteger(state.ciRunId) && state.ciRunId > 0
      : state.ciRunId === null) &&
    (apiRequired
      ? typeof state.apiDeploymentId === "string" && deploymentPattern.test(state.apiDeploymentId)
      : state.apiDeploymentId === null) &&
    (webRequired
      ? typeof state.webDeploymentId === "string" && deploymentPattern.test(state.webDeploymentId)
      : state.webDeploymentId === null)
  );
}

export function validateHostedReleaseState(state) {
  try {
    const expectedKeys =
      state?.schemaVersion === 1
        ? stateV1Keys
        : state?.schemaVersion === 2
          ? stateV2Keys
          : stateV3Keys;
    if (
      typeof state !== "object" ||
      state === null ||
      Array.isArray(state) ||
      Object.keys(state).sort().join("|") !== [...expectedKeys].sort().join("|") ||
      ![1, 2, 3].includes(state.schemaVersion) ||
      state.branch !== hostedReleaseBranch ||
      typeof state.candidateSha !== "string" ||
      !commitPattern.test(state.candidateSha) ||
      state.releaseId !== releaseIdForCandidate(state.candidateSha) ||
      !Number.isSafeInteger(state.createdAt) ||
      state.createdAt <= 0 ||
      !Number.isSafeInteger(state.updatedAt) ||
      state.updatedAt < state.createdAt
    ) {
      fail();
    }
    if (state.schemaVersion >= 2 && !validHostedReleaseAttemptId(state.releaseAttemptId)) fail();
    if (
      state.schemaVersion === 3 &&
      ![ordinaryReleaseProvenance, hostedCronBootstrapReleaseProvenance].includes(state.provenance)
    ) {
      fail();
    }
    const phaseIndex = hostedReleasePhases.indexOf(state.phase);
    if (phaseIndex < 0 || !evidenceIsValid(state, phaseIndex)) fail();
    return Object.freeze({ ...state });
  } catch {
    fail();
  }
}

function createCurrentHostedReleaseState({ candidateSha, now, provenance, releaseAttemptId }) {
  return validateHostedReleaseState({
    apiDeploymentId: null,
    branch: hostedReleaseBranch,
    candidateSha,
    ciRunId: null,
    createdAt: now,
    phase: "candidate-recorded",
    provenance,
    releaseAttemptId,
    releaseId: releaseIdForCandidate(candidateSha),
    schemaVersion: 3,
    updatedAt: now,
    webDeploymentId: null,
  });
}

export function createHostedReleaseState({ candidateSha, now, releaseAttemptId }) {
  return createCurrentHostedReleaseState({
    candidateSha,
    now,
    provenance: ordinaryReleaseProvenance,
    releaseAttemptId,
  });
}

export function createHostedCronBootstrapReleaseState({ candidateSha, now, releaseAttemptId }) {
  return createCurrentHostedReleaseState({
    candidateSha,
    now,
    provenance: hostedCronBootstrapReleaseProvenance,
    releaseAttemptId,
  });
}

export function transitionHostedReleaseState(state, update) {
  const current = validateHostedReleaseState(state);
  const currentIndex = hostedReleasePhases.indexOf(current.phase);
  const nextIndex = hostedReleasePhases.indexOf(update?.phase);
  if (
    typeof update !== "object" ||
    update === null ||
    Array.isArray(update) ||
    nextIndex !== currentIndex + 1 ||
    !Number.isSafeInteger(update.now) ||
    update.now < current.updatedAt ||
    Object.keys(update).some(
      (key) => !["apiDeploymentId", "ciRunId", "now", "phase", "webDeploymentId"].includes(key),
    )
  ) {
    fail();
  }
  return validateHostedReleaseState({
    ...current,
    ...(update.ciRunId === undefined ? {} : { ciRunId: update.ciRunId }),
    ...(update.apiDeploymentId === undefined ? {} : { apiDeploymentId: update.apiDeploymentId }),
    ...(update.webDeploymentId === undefined ? {} : { webDeploymentId: update.webDeploymentId }),
    phase: update.phase,
    updatedAt: update.now,
  });
}
