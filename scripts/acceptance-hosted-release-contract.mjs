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
const stateKeys = Object.freeze([
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

function fail() {
  throw new Error("Hosted acceptance release state failed closed.");
}

export function releaseIdForCandidate(candidateSha) {
  if (typeof candidateSha !== "string" || !commitPattern.test(candidateSha)) fail();
  return `hosted-acceptance-${candidateSha}`;
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
    if (
      typeof state !== "object" ||
      state === null ||
      Array.isArray(state) ||
      Object.keys(state).sort().join("|") !== [...stateKeys].sort().join("|") ||
      state.schemaVersion !== 1 ||
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
    const phaseIndex = hostedReleasePhases.indexOf(state.phase);
    if (phaseIndex < 0 || !evidenceIsValid(state, phaseIndex)) fail();
    return Object.freeze({ ...state });
  } catch {
    fail();
  }
}

export function createHostedReleaseState({ candidateSha, now }) {
  return validateHostedReleaseState({
    apiDeploymentId: null,
    branch: hostedReleaseBranch,
    candidateSha,
    ciRunId: null,
    createdAt: now,
    phase: "candidate-recorded",
    releaseId: releaseIdForCandidate(candidateSha),
    schemaVersion: 1,
    updatedAt: now,
    webDeploymentId: null,
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
