import { expectedVercelOneShotBaselines } from "./acceptance-vercel-one-shot-config.mjs";

const commitPattern = /^[0-9a-f]{40}$/u;
const terminalStates = new Set(["CANCELED", "ERROR", "READY"]);
const allowedStates = new Set(["BUILDING", "CANCELED", "ERROR", "INITIALIZING", "QUEUED", "READY"]);

function fail() {
  throw new Error("Hosted Vercel one-shot contract failed.");
}

function hasExactKeys(value, keys) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

export function assertVercelOneShotCommit(value) {
  if (typeof value !== "string" || !commitPattern.test(value)) fail();
}

export function assertVercelOneShotDeployment(value, project) {
  if (
    !hasExactKeys(value, ["createdAt", "id", "project", "sha", "state"]) ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9_-]{3,128}$/u.test(value.id) ||
    value.project !== project ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !allowedStates.has(value.state)
  ) {
    fail();
  }
  assertVercelOneShotCommit(value.sha);
}

export function assertVercelOneShotHistory(
  history,
  project,
  { allowEmpty = false, allowOneInFlight = false, canceledOnly = false } = {},
) {
  if (!Array.isArray(history) || (!allowEmpty && history.length === 0)) fail();
  const ids = new Set();
  let previousCreatedAt = Number.POSITIVE_INFINITY;
  let inFlight = 0;
  for (const deployment of history) {
    assertVercelOneShotDeployment(deployment, project);
    if (
      ids.has(deployment.id) ||
      deployment.createdAt > previousCreatedAt ||
      (canceledOnly && deployment.state !== "CANCELED")
    ) {
      fail();
    }
    ids.add(deployment.id);
    previousCreatedAt = deployment.createdAt;
    if (!terminalStates.has(deployment.state)) inFlight += 1;
  }
  if (inFlight > (allowOneInFlight ? 1 : 0)) fail();
}

export function assertVercelOneShotSnapshot(
  snapshot,
  { allowApiInFlight = false, allowWebInFlight = false } = {},
) {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot) ||
    Object.keys(snapshot).sort().join(",") !== "api,web"
  ) {
    fail();
  }
  assertVercelOneShotHistory(snapshot.api, "api", { allowOneInFlight: allowApiInFlight });
  assertVercelOneShotHistory(snapshot.web, "web", { allowOneInFlight: allowWebInFlight });
}

export function fingerprintVercelOneShotHistory(history) {
  return history.map(({ createdAt, id, project, sha, state }) => ({
    createdAt,
    id,
    project,
    sha,
    state,
  }));
}

function sameDeployment(left, right, { mutableState = false } = {}) {
  return (
    left.createdAt === right.createdAt &&
    left.id === right.id &&
    left.project === right.project &&
    left.sha === right.sha &&
    (mutableState || left.state === right.state)
  );
}

export function assertVercelOneShotBaselines(baselines) {
  if (!hasExactKeys(baselines, ["api", "web"])) fail();
  for (const project of ["api", "web"]) {
    const expected = baselines[project];
    if (
      !hasExactKeys(expected, ["count", "latestCommit", "latestDeploymentId"]) ||
      !Number.isSafeInteger(expected.count) ||
      expected.count < 1 ||
      typeof expected.latestDeploymentId !== "string" ||
      !/^dpl_[A-Za-z0-9_-]{3,128}$/u.test(expected.latestDeploymentId)
    ) {
      fail();
    }
    assertVercelOneShotCommit(expected.latestCommit);
  }
}

export function assertVercelOneShotFixedBaseline(
  snapshot,
  expectedBaselines = expectedVercelOneShotBaselines,
) {
  assertVercelOneShotBaselines(expectedBaselines);
  if (
    !hasExactKeys(snapshot, ["api", "web"]) ||
    !Array.isArray(snapshot.api) ||
    !Array.isArray(snapshot.web)
  ) {
    fail();
  }
  for (const project of ["api", "web"]) {
    const expected = expectedBaselines[project];
    const nonCanceled = snapshot[project].filter(({ state }) => state !== "CANCELED");
    if (
      nonCanceled.length !== expected.count ||
      nonCanceled[0].id !== expected.latestDeploymentId ||
      nonCanceled[0].sha !== expected.latestCommit ||
      nonCanceled[0].state !== "READY"
    ) {
      fail();
    }
  }
}

export function reconcileVercelOneShotHistory({
  actual,
  audits,
  baseline,
  mutableTarget,
  project,
  target,
}) {
  const known = [...baseline, ...audits, ...(target === undefined ? [] : [target])];
  const actualById = new Map(actual.map((deployment) => [deployment.id, deployment]));
  for (const expected of known) {
    const current = actualById.get(expected.id);
    if (
      current === undefined ||
      !sameDeployment(current, expected, { mutableState: mutableTarget?.id === expected.id })
    ) {
      fail();
    }
  }
  const knownIds = new Set(known.map(({ id }) => id));
  return {
    additions: actual.filter(({ id }) => !knownIds.has(id)),
    target:
      target === undefined
        ? undefined
        : actual.find(({ id }) => id === target.id && project === target.project),
  };
}

export function acceptVercelOneShotCanceledAudit(additions, commit) {
  if (
    additions.length > 1 ||
    additions.some(({ sha, state }) => sha !== commit || state !== "CANCELED")
  ) {
    fail();
  }
  return fingerprintVercelOneShotHistory(additions);
}

export function acceptVercelOneShotArmedDeployment(additions, commit, project) {
  if (
    additions.length !== 1 ||
    additions[0].project !== project ||
    additions[0].sha !== commit ||
    additions[0].state === "CANCELED"
  ) {
    fail();
  }
  return { ...additions[0] };
}
