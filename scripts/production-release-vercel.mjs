export const productionTargets = Object.freeze({
  teamId: "team_wwsOIXsMf7TkmL3Y581MmbNS",
  teamSlug: "neil0619s-projects",
  api: Object.freeze({
    id: "prj_NePC3jZHC6UBARQjRzImNcAmbrdu",
    name: "seen-said-production-api",
    domain: "api.seen-said.cn",
    framework: "hono",
    rootDirectory: "apps/api",
  }),
  web: Object.freeze({
    id: "prj_ctTRu2NzDycVUci7hG1QTp25t3dA",
    name: "seen-said-production-web",
    domain: "app.seen-said.cn",
    framework: "vite",
    rootDirectory: "apps/web",
  }),
});

const failure = "Production release failed closed; reconcile recorded attempts before any retry.";
const states = new Set([
  "QUEUED",
  "INITIALIZING",
  "BUILDING",
  "READY",
  "ERROR",
  "CANCELED",
  "BLOCKED",
]);
const activeStates = ["QUEUED", "INITIALIZING", "BUILDING"];
const branch = "codex/settings-configuration";
const deploymentId = /^dpl_[A-Za-z0-9_-]{3,128}$/u;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = () => {
  throw new Error(failure);
};

function assertIdentity({ candidateSha, attemptId, releaseId, kind }) {
  if (
    !/^[a-f0-9]{40}$/u.test(candidateSha) ||
    !/^[a-f0-9]{32}$/u.test(attemptId) ||
    releaseId !== `production-${candidateSha}` ||
    !["api", "web"].includes(kind)
  )
    fail();
}

function normalizedDeployment(raw, identity) {
  const target = productionTargets[identity.kind];
  const id = raw?.uid ?? raw?.id;
  if (
    !deploymentId.test(id) ||
    raw.name !== target.name ||
    raw.projectId !== target.id ||
    raw.target !== "production" ||
    !states.has(raw.readyState) ||
    raw.meta?.githubCommitSha !== identity.candidateSha ||
    raw.meta?.huayiCandidateSha !== identity.candidateSha ||
    raw.meta?.huayiReleaseAttemptId !== identity.attemptId ||
    raw.meta?.huayiReleaseId !== identity.releaseId ||
    raw.meta?.huayiReleaseChannel !== "production"
  )
    fail();
  return Object.freeze({ id, state: raw.readyState });
}

function variableMatches(variable, key) {
  return (
    isRecord(variable) &&
    typeof variable.id === "string" &&
    /^[A-Za-z0-9_-]{1,256}$/u.test(variable.id) &&
    variable.key === key &&
    variable.type === "encrypted" &&
    variable.gitBranch == null &&
    Array.isArray(variable.target) &&
    variable.target.length === 1 &&
    variable.target[0] === "production"
  );
}

// recordAttempt must durably create an exclusive receipt before resolving. Existing or uncertain
// receipts must reject; callers reconcile with find rather than replaying a create after a restart.
export function createProductionReleaseVercel({
  token,
  environment,
  recordAttempt,
  fetch_ = globalThis.fetch,
}) {
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 4096 ||
    /[\0\r\n]/u.test(token)
  )
    fail();
  if (typeof recordAttempt !== "function" || typeof fetch_ !== "function") fail();
  const desired = {};
  for (const kind of ["api", "web"]) {
    if (!isRecord(environment?.[kind]) || Object.keys(environment[kind]).length === 0) fail();
    desired[kind] = Object.freeze({ ...environment[kind] });
    if (
      Object.entries(desired[kind]).some(
        ([key, value]) =>
          !/^[A-Z][A-Z0-9_]{1,127}$/u.test(key) ||
          typeof value !== "string" ||
          value.length === 0 ||
          value.length > 16384 ||
          /[\0\r\n]/u.test(value),
      )
    )
      fail();
  }
  if (
    desired.api.HUAYI_DEPLOYMENT_ENVIRONMENT !== "production" ||
    desired.web.VITE_DEPLOYMENT_ENVIRONMENT !== "production" ||
    desired.api.HUAYI_API_ORIGIN !== "https://api.seen-said.cn" ||
    desired.web.VITE_API_ORIGIN !== "https://api.seen-said.cn"
  )
    fail();
  const attempts = new Set();

  async function request(path, query = {}, body) {
    const url = new URL(path, "https://api.vercel.com");
    for (const [key, value] of Object.entries({ teamId: productionTargets.teamId, ...query }))
      url.searchParams.set(key, String(value));
    const response = await fetch_(url.href, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) fail();
    const text = await response.text();
    if (text.length > 1000000) fail();
    const result = JSON.parse(text);
    if (!isRecord(result)) fail();
    return result;
  }

  async function inspectProjects() {
    const team = await request(`/v2/teams/${productionTargets.teamId}`);
    if (
      team.id !== productionTargets.teamId ||
      team.slug !== productionTargets.teamSlug ||
      team.billing?.plan !== "hobby"
    )
      fail();
    for (const kind of ["api", "web"]) {
      const target = productionTargets[kind];
      const project = await request(`/v9/projects/${target.id}`);
      if (
        project.id !== target.id ||
        project.accountId !== team.id ||
        project.name !== target.name ||
        project.framework !== target.framework ||
        project.rootDirectory !== target.rootDirectory ||
        project.nodeVersion !== "24.x" ||
        project.previewDeploymentsDisabled !== true
      )
        fail();
      if (
        project.link != null &&
        (project.link.type !== "github" ||
          project.link.org !== "Neil0619" ||
          project.link.repo !== "huayi" ||
          project.link.repoId !== 1297632474 ||
          project.link.productionBranch !== branch)
      )
        fail();
      const domains = await request(`/v9/projects/${target.id}/domains`);
      if (!Array.isArray(domains.domains) || domains.pagination?.next != null) fail();
      const matches = domains.domains.filter(({ name }) => name === target.domain);
      if (matches.length !== 1 || matches[0].verified !== true || matches[0].redirect != null)
        fail();
    }
  }

  async function readEnvironment(kind) {
    const target = productionTargets[kind];
    const listed = await request(`/v10/projects/${target.id}/env`);
    if (!Array.isArray(listed.envs) || listed.envs.length !== Object.keys(desired[kind]).length)
      return false;
    for (const [key, value] of Object.entries(desired[kind])) {
      const matches = listed.envs.filter((item) => item.key === key);
      if (matches.length !== 1 || !variableMatches(matches[0], key)) return false;
      const variable = await request(`/v1/projects/${target.id}/env/${matches[0].id}`);
      if (
        !variableMatches(variable, key) ||
        variable.id !== matches[0].id ||
        variable.decrypted !== true ||
        variable.value !== value
      )
        return false;
    }
    return true;
  }

  async function list(kind, query) {
    const result = await request("/v7/deployments", {
      projectId: productionTargets[kind].id,
      limit: 100,
      ...query,
    });
    if (!Array.isArray(result.deployments) || result.pagination?.next != null) fail();
    return result.deployments;
  }

  async function assertIdle() {
    for (const kind of ["api", "web"]) {
      for (const state of activeStates) {
        if ((await list(kind, { state, limit: 1 })).length !== 0) fail();
      }
    }
  }

  async function find(identity) {
    assertIdentity(identity);
    await inspectProjects();
    const listed = await list(identity.kind, { sha: identity.candidateSha, target: "production" });
    const matches = listed.filter(
      (raw) =>
        raw.meta?.huayiReleaseId === identity.releaseId &&
        raw.meta?.huayiReleaseAttemptId === identity.attemptId,
    );
    if (matches.length > 1) fail();
    return matches.length === 0 ? undefined : normalizedDeployment(matches[0], identity);
  }

  const guarded =
    (operation) =>
    async (...args) => {
      try {
        return await operation(...args);
      } catch {
        fail();
      }
    };
  return Object.freeze({
    inspect: guarded(async () => {
      await inspectProjects();
      await assertIdle();
      return {
        projectsReady: true,
        noInFlightDeployments: true,
        configurationReady: (await readEnvironment("api")) && (await readEnvironment("web")),
      };
    }),
    find: guarded(find),
    initializeEnvironment: guarded(async ({ kind, attemptId }) => {
      if (!["api", "web"].includes(kind) || !/^[a-f0-9]{32}$/u.test(attemptId)) fail();
      await inspectProjects();
      await assertIdle();
      if (await readEnvironment(kind)) return { configured: true };
      const target = productionTargets[kind];
      const existing = await request(`/v10/projects/${target.id}/env`);
      if (
        !Array.isArray(existing.envs) ||
        existing.envs.length !== 0 ||
        attempts.has(`environment:${kind}`)
      )
        fail();
      attempts.add(`environment:${kind}`);
      await recordAttempt(
        Object.freeze({
          releaseId: "production-environment",
          phase: "environment",
          kind,
          attemptId,
          projectId: target.id,
        }),
      );
      await request(
        `/v10/projects/${target.id}/env`,
        { upsert: false },
        Object.entries(desired[kind]).map(([key, value]) => ({
          key,
          value,
          type: "encrypted",
          target: ["production"],
        })),
      );
      if (!(await readEnvironment(kind))) fail();
      return { configured: true };
    }),
    create: guarded(async (identity) => {
      assertIdentity(identity);
      const attemptKey = `${identity.releaseId}:${identity.kind}`;
      if (attempts.has(attemptKey)) fail();
      if ((await find(identity)) !== undefined) fail();
      if (!(await readEnvironment("api")) || !(await readEnvironment("web"))) fail();
      await assertIdle();
      attempts.add(attemptKey);
      await recordAttempt(
        Object.freeze({ ...identity, projectId: productionTargets[identity.kind].id }),
      );
      const target = productionTargets[identity.kind];
      const created = await request(
        "/v13/deployments",
        { forceNew: 1 },
        {
          name: target.name,
          project: target.id,
          target: "production",
          gitSource: {
            type: "github",
            repoId: 1297632474,
            ref: branch,
            sha: identity.candidateSha,
          },
          projectSettings: {
            framework: target.framework,
            rootDirectory: target.rootDirectory,
            nodeVersion: "24.x",
            buildCommand: "pnpm build:vercel",
          },
          meta: {
            huayiCandidateSha: identity.candidateSha,
            huayiReleaseAttemptId: identity.attemptId,
            huayiReleaseId: identity.releaseId,
            huayiReleaseChannel: "production",
          },
        },
      );
      return normalizedDeployment(created, identity);
    }),
  });
}
