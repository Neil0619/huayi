import {
  acceptVercelOneShotArmedDeployment,
  acceptVercelOneShotCanceledAudit,
  assertVercelOneShotCommit,
  assertVercelOneShotDeployment,
  assertVercelOneShotFixedBaseline,
  assertVercelOneShotHistory,
  assertVercelOneShotSnapshot,
  fingerprintVercelOneShotHistory,
  reconcileVercelOneShotHistory,
} from "./acceptance-vercel-one-shot-history.mjs";

const digestPattern = /^[0-9a-f]{64}$/u;
const branch = "codex/settings-configuration";
const contract = "huayi-hosted-vercel-serial-one-shot/v1";

function fail() {
  throw new Error("Hosted Vercel one-shot contract failed.");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertGitBase(git) {
  if (
    !isRecord(git) ||
    git.clean !== true ||
    git.branch !== branch ||
    !Array.isArray(git.changedFiles) ||
    git.changedFiles.some((value) => typeof value !== "string") ||
    typeof git.apiArmed !== "boolean" ||
    typeof git.webArmed !== "boolean" ||
    typeof git.apiConfigIdentity !== "string" ||
    !digestPattern.test(git.apiConfigIdentity) ||
    typeof git.webConfigIdentity !== "string" ||
    !digestPattern.test(git.webConfigIdentity)
  ) {
    fail();
  }
  assertVercelOneShotCommit(git.commit);
  assertVercelOneShotCommit(git.upstreamCommit);
  if (git.commit !== git.upstreamCommit || (git.apiArmed && git.webArmed)) fail();
}

function assertGitPolicy(git, { apiArmed, webArmed }) {
  assertGitBase(git);
  if (git.apiArmed !== apiArmed || git.webArmed !== webArmed) fail();
}

function assertTransitionCommit(git, { changedFile, parent }) {
  assertVercelOneShotCommit(parent);
  assertVercelOneShotCommit(git.parent);
  if (
    git.parent !== parent ||
    git.changedFiles.length !== 1 ||
    git.changedFiles[0] !== changedFile
  ) {
    fail();
  }
}

function assertState(state, phase) {
  const phaseKeys = {
    "api-arm-observed": [
      "apiArmCommit",
      "apiDeployment",
      "audits",
      "baseline",
      "candidateCommit",
      "configIdentities",
      "contract",
      "phase",
    ],
    "api-disarm-verified": [
      "apiArmCommit",
      "apiDeployment",
      "apiDisarmCommit",
      "audits",
      "baseline",
      "candidateCommit",
      "configIdentities",
      "contract",
      "phase",
    ],
    complete: [
      "apiArmCommit",
      "apiDeployment",
      "apiDisarmCommit",
      "audits",
      "baseline",
      "candidateCommit",
      "configIdentities",
      "contract",
      "phase",
      "webArmCommit",
      "webDeployment",
      "webDisarmCommit",
    ],
    "preflight-passed": [
      "audits",
      "baseline",
      "candidateCommit",
      "configIdentities",
      "contract",
      "phase",
    ],
    "web-arm-observed": [
      "apiArmCommit",
      "apiDeployment",
      "apiDisarmCommit",
      "audits",
      "baseline",
      "candidateCommit",
      "configIdentities",
      "contract",
      "phase",
      "webArmCommit",
      "webDeployment",
    ],
  };
  if (
    !Object.hasOwn(phaseKeys, phase) ||
    !hasExactKeys(state, phaseKeys[phase]) ||
    state.contract !== contract ||
    state.phase !== phase ||
    !hasExactKeys(state.audits, ["api", "web"]) ||
    !hasExactKeys(state.baseline, ["api", "web"]) ||
    !hasExactKeys(state.configIdentities, ["api", "web"]) ||
    typeof state.configIdentities.api !== "string" ||
    !digestPattern.test(state.configIdentities.api) ||
    typeof state.configIdentities.web !== "string" ||
    !digestPattern.test(state.configIdentities.web) ||
    !Array.isArray(state.baseline.api) ||
    !Array.isArray(state.baseline.web)
  ) {
    fail();
  }
  assertVercelOneShotCommit(state.candidateCommit);
  assertVercelOneShotHistory(state.baseline.api, "api");
  assertVercelOneShotHistory(state.baseline.web, "web");
  assertVercelOneShotHistory(state.audits.api, "api", { allowEmpty: true, canceledOnly: true });
  assertVercelOneShotHistory(state.audits.web, "web", { allowEmpty: true, canceledOnly: true });
  assertVercelOneShotFixedBaseline(state.baseline);
  if (phase !== "preflight-passed") {
    assertVercelOneShotCommit(state.apiArmCommit);
    assertVercelOneShotDeployment(state.apiDeployment, "api");
    if (
      state.apiDeployment.sha !== state.apiArmCommit ||
      state.apiDeployment.state === "CANCELED"
    ) {
      fail();
    }
  }
  if (["api-disarm-verified", "web-arm-observed", "complete"].includes(phase)) {
    assertVercelOneShotCommit(state.apiDisarmCommit);
  }
  if (["web-arm-observed", "complete"].includes(phase)) {
    assertVercelOneShotCommit(state.webArmCommit);
    assertVercelOneShotDeployment(state.webDeployment, "web");
    if (
      state.webDeployment.sha !== state.webArmCommit ||
      state.webDeployment.state === "CANCELED"
    ) {
      fail();
    }
  }
  if (phase === "complete") assertVercelOneShotCommit(state.webDisarmCommit);
  assertAuditPolicy(state, phase);
  assertStateIdentityUniqueness(state);
}

function assertAuditPolicy(state, phase) {
  const allowed = { api: [], web: [] };
  if (phase !== "preflight-passed") allowed.web.push(state.apiArmCommit);
  if (["api-disarm-verified", "web-arm-observed", "complete"].includes(phase)) {
    allowed.api.push(state.apiDisarmCommit);
    allowed.web.push(state.apiDisarmCommit);
  }
  if (["web-arm-observed", "complete"].includes(phase)) allowed.api.push(state.webArmCommit);
  if (phase === "complete") {
    allowed.api.push(state.webDisarmCommit);
    allowed.web.push(state.webDisarmCommit);
  }
  for (const project of ["api", "web"]) {
    const counts = new Map();
    for (const audit of state.audits[project]) {
      if (!allowed[project].includes(audit.sha)) fail();
      counts.set(audit.sha, (counts.get(audit.sha) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) fail();
  }
}

function assertStateIdentityUniqueness(state) {
  for (const project of ["api", "web"]) {
    const deployments = [...state.baseline[project], ...state.audits[project]];
    const target = state[`${project}Deployment`];
    if (target !== undefined) deployments.push(target);
    if (new Set(deployments.map(({ id }) => id)).size !== deployments.length) fail();
  }
}

function assertConfigIdentities(git, state) {
  if (
    git.apiConfigIdentity !== state.configIdentities.api ||
    git.webConfigIdentity !== state.configIdentities.web
  ) {
    fail();
  }
}

function reconcile(snapshot, state, project, { mutableTarget = false, target } = {}) {
  return reconcileVercelOneShotHistory({
    actual: snapshot[project],
    audits: state.audits[project],
    baseline: state.baseline[project],
    mutableTarget: mutableTarget ? target : undefined,
    project,
    target,
  });
}

function mergeAudits(state, snapshot, additions) {
  const merged = {};
  for (const project of ["api", "web"]) {
    const ids = new Set([
      ...state.audits[project].map(({ id }) => id),
      ...additions[project].map(({ id }) => id),
    ]);
    merged[project] = fingerprintVercelOneShotHistory(
      snapshot[project].filter(({ id }) => ids.has(id)),
    );
  }
  return merged;
}

function preflight({ git, snapshot }) {
  assertGitPolicy(git, { apiArmed: false, webArmed: false });
  assertVercelOneShotSnapshot(snapshot);
  assertVercelOneShotFixedBaseline(snapshot);
  return {
    audits: { api: [], web: [] },
    baseline: {
      api: fingerprintVercelOneShotHistory(snapshot.api),
      web: fingerprintVercelOneShotHistory(snapshot.web),
    },
    candidateCommit: git.commit,
    configIdentities: { api: git.apiConfigIdentity, web: git.webConfigIdentity },
    contract,
    phase: "preflight-passed",
  };
}

function observeApiArm({ git, snapshot, state }) {
  assertState(state, "preflight-passed");
  assertGitPolicy(git, { apiArmed: true, webArmed: false });
  assertConfigIdentities(git, state);
  assertTransitionCommit(git, {
    changedFile: "apps/api/vercel.json",
    parent: state.candidateCommit,
  });
  assertVercelOneShotSnapshot(snapshot, { allowApiInFlight: true });
  const api = reconcile(snapshot, state, "api");
  const web = reconcile(snapshot, state, "web");
  const apiDeployment = acceptVercelOneShotArmedDeployment(api.additions, git.commit, "api");
  const additions = {
    api: [],
    web: acceptVercelOneShotCanceledAudit(web.additions, git.commit),
  };
  return {
    ...state,
    apiArmCommit: git.commit,
    apiDeployment,
    audits: mergeAudits(state, snapshot, additions),
    phase: "api-arm-observed",
  };
}

function verifyApiDisarm({ git, snapshot, state }) {
  assertState(state, "api-arm-observed");
  assertGitPolicy(git, { apiArmed: false, webArmed: false });
  assertConfigIdentities(git, state);
  assertTransitionCommit(git, {
    changedFile: "apps/api/vercel.json",
    parent: state.apiArmCommit,
  });
  assertVercelOneShotSnapshot(snapshot);
  const api = reconcile(snapshot, state, "api", {
    mutableTarget: true,
    target: state.apiDeployment,
  });
  const web = reconcile(snapshot, state, "web");
  if (api.target?.state !== "READY") fail();
  const additions = {
    api: acceptVercelOneShotCanceledAudit(api.additions, git.commit),
    web: acceptVercelOneShotCanceledAudit(web.additions, git.commit),
  };
  return {
    ...state,
    apiDeployment: { ...api.target },
    apiDisarmCommit: git.commit,
    audits: mergeAudits(state, snapshot, additions),
    phase: "api-disarm-verified",
  };
}

function observeWebArm({ git, snapshot, state }) {
  assertState(state, "api-disarm-verified");
  assertGitPolicy(git, { apiArmed: false, webArmed: true });
  assertConfigIdentities(git, state);
  assertTransitionCommit(git, {
    changedFile: "apps/web/vercel.json",
    parent: state.apiDisarmCommit,
  });
  assertVercelOneShotSnapshot(snapshot, { allowWebInFlight: true });
  const api = reconcile(snapshot, state, "api", { target: state.apiDeployment });
  const web = reconcile(snapshot, state, "web");
  if (api.target?.state !== "READY") fail();
  const webDeployment = acceptVercelOneShotArmedDeployment(web.additions, git.commit, "web");
  const additions = {
    api: acceptVercelOneShotCanceledAudit(api.additions, git.commit),
    web: [],
  };
  return {
    ...state,
    audits: mergeAudits(state, snapshot, additions),
    phase: "web-arm-observed",
    webArmCommit: git.commit,
    webDeployment: { ...webDeployment },
  };
}

function verifyWebDisarm({ git, snapshot, state }) {
  assertState(state, "web-arm-observed");
  assertGitPolicy(git, { apiArmed: false, webArmed: false });
  assertConfigIdentities(git, state);
  assertTransitionCommit(git, {
    changedFile: "apps/web/vercel.json",
    parent: state.webArmCommit,
  });
  assertVercelOneShotSnapshot(snapshot);
  const api = reconcile(snapshot, state, "api", { target: state.apiDeployment });
  const web = reconcile(snapshot, state, "web", {
    mutableTarget: true,
    target: state.webDeployment,
  });
  if (api.target?.state !== "READY" || web.target?.state !== "READY") fail();
  const additions = {
    api: acceptVercelOneShotCanceledAudit(api.additions, git.commit),
    web: acceptVercelOneShotCanceledAudit(web.additions, git.commit),
  };
  return {
    ...state,
    audits: mergeAudits(state, snapshot, additions),
    phase: "complete",
    webDeployment: { ...web.target },
    webDisarmCommit: git.commit,
  };
}

const priorPhases = Object.freeze({
  "observe-api-arm": "preflight-passed",
  "observe-web-arm": "api-disarm-verified",
  "verify-api-disarm": "api-arm-observed",
  "verify-web-disarm": "web-arm-observed",
});

export function validateVercelOneShotStoredState(state, stage) {
  if (!Object.hasOwn(priorPhases, stage)) fail();
  assertState(state, priorPhases[stage]);
}

export function advanceVercelOneShotState({ git, snapshot, stage, state }) {
  if (stage === "preflight" && state === undefined) return preflight({ git, snapshot });
  if (stage === "observe-api-arm") return observeApiArm({ git, snapshot, state });
  if (stage === "verify-api-disarm") return verifyApiDisarm({ git, snapshot, state });
  if (stage === "observe-web-arm") return observeWebArm({ git, snapshot, state });
  if (stage === "verify-web-disarm") return verifyWebDisarm({ git, snapshot, state });
  fail();
}
