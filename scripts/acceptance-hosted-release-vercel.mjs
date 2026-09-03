import {
  hostedReleaseBranch,
  hostedReleaseExtensionId,
  releaseIdForCandidate,
  validHostedReleaseAttemptId,
} from "./acceptance-hosted-release-contract.mjs";
import { createHostedReleaseRuntime } from "./acceptance-hosted-release-runtime.mjs";
import { expectedTeamName, expectedTeamSlug } from "./acceptance-vercel-projects-config.mjs";
import { requestJson, urlFor } from "./acceptance-vercel-projects-http.mjs";

const desiredEnvironment = Object.freeze([
  Object.freeze({
    key: "HUAYI_MIN_SUPPORTED_EXTENSION_VERSION",
    target: Object.freeze(["production"]),
    type: "encrypted",
    value: "1.0.0",
  }),
  Object.freeze({
    key: "HUAYI_STORE_EXTENSION_CAPABILITY",
    target: Object.freeze(["production"]),
    type: "encrypted",
    value: "enabled",
  }),
  Object.freeze({
    key: "HUAYI_STORE_EXTENSION_ID",
    target: Object.freeze(["production"]),
    type: "encrypted",
    value: hostedReleaseExtensionId,
  }),
]);
const projectSpecifications = Object.freeze({
  api: Object.freeze({ framework: "hono", name: "seen-said-acceptance-api", root: "apps/api" }),
  web: Object.freeze({ framework: "vite", name: "seen-said-acceptance-web", root: "apps/web" }),
});
const deploymentStates = new Set([
  "BLOCKED",
  "BUILDING",
  "CANCELED",
  "ERROR",
  "INITIALIZING",
  "QUEUED",
  "READY",
]);
const inFlightStates = Object.freeze(["BUILDING", "INITIALIZING", "QUEUED"]);
const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;
const environmentVariableIdPattern = /^[A-Za-z0-9_-]{1,256}$/u;

function fail() {
  throw new Error("Hosted acceptance release Vercel failed closed.");
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validToken(token) {
  return (
    typeof token === "string" &&
    token.length >= 16 &&
    token.length <= 4_096 &&
    token.trim() === token &&
    !/[\0\r\n]/u.test(token)
  );
}

function validDeploymentIdentity({ candidateSha, kind, releaseAttemptId, releaseId }) {
  return (
    Object.hasOwn(projectSpecifications, kind) &&
    commitPattern.test(candidateSha) &&
    validHostedReleaseAttemptId(releaseAttemptId) &&
    releaseId === releaseIdForCandidate(candidateSha)
  );
}

function projectUrl(name, teamId) {
  return urlFor(`/v9/projects/${name}`, { teamId });
}

function parseProject(project, kind, teamId) {
  const specification = projectSpecifications[kind];
  if (
    !record(project) ||
    typeof project.id !== "string" ||
    !/^prj_[A-Za-z0-9_-]+$/u.test(project.id) ||
    project.accountId !== teamId ||
    project.name !== specification.name ||
    project.framework !== specification.framework ||
    project.rootDirectory !== specification.root ||
    !record(project.link) ||
    project.link.type !== "github" ||
    project.link.org !== "Neil0619" ||
    project.link.repo !== "huayi" ||
    project.link.productionBranch !== hostedReleaseBranch ||
    !Number.isSafeInteger(project.link.repoId) ||
    project.link.repoId <= 0
  ) {
    fail();
  }
  return Object.freeze({ id: project.id, name: project.name, repoId: project.link.repoId });
}

function exactProductionVariableMetadata(variable, desired) {
  return (
    record(variable) &&
    typeof variable.id === "string" &&
    environmentVariableIdPattern.test(variable.id) &&
    variable.key === desired.key &&
    variable.type === desired.type &&
    Array.isArray(variable.target) &&
    variable.target.length === 1 &&
    variable.target[0] === "production" &&
    variable.gitBranch == null
  );
}

function listedConfiguration(response) {
  if (!record(response) || !Array.isArray(response.envs)) fail();
  const variables = [];
  for (const desired of desiredEnvironment) {
    const matches = response.envs.filter((variable) => variable?.key === desired.key);
    if (matches.length > 1) fail();
    if (matches.length !== 1 || !exactProductionVariableMetadata(matches[0], desired)) {
      return undefined;
    }
    variables.push(Object.freeze({ desired, id: matches[0].id }));
  }
  return Object.freeze(variables);
}

function exactDecryptedProductionVariable(variable, desired, id) {
  return (
    exactProductionVariableMetadata(variable, desired) &&
    variable.id === id &&
    variable.decrypted === true &&
    variable.value === desired.value
  );
}

function parseDeployment(raw, kind, candidateSha, releaseAttemptId, releaseId, projectId) {
  if (
    !record(raw) ||
    typeof raw.uid !== "string" ||
    !deploymentPattern.test(raw.uid) ||
    raw.name !== projectSpecifications[kind].name ||
    raw.projectId !== projectId ||
    raw.target !== "production" ||
    !deploymentStates.has(raw.readyState) ||
    !record(raw.meta) ||
    raw.meta.githubCommitSha !== candidateSha ||
    raw.meta.huayiCandidateSha !== candidateSha ||
    raw.meta.huayiReleaseAttemptId !== releaseAttemptId ||
    raw.meta.huayiReleaseId !== releaseId
  ) {
    fail();
  }
  return Object.freeze({ id: raw.uid, state: raw.readyState });
}

export function createHostedReleaseVercel({
  fetch_ = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  token,
} = {}) {
  if (!validToken(token) || typeof fetch_ !== "function" || typeof sleep !== "function") fail();
  const runtime = createHostedReleaseRuntime({ fetch_ });
  let scopePromise;

  async function scope() {
    scopePromise ??= (async () => {
      const teams = await requestJson({
        fetch_,
        stage: "release-resolve-team",
        token,
        url: urlFor("/v2/teams", { limit: 100 }),
      });
      if (
        !Array.isArray(teams.teams) ||
        !record(teams.pagination) ||
        teams.pagination.count !== teams.teams.length ||
        teams.pagination.next !== null
      ) {
        fail();
      }
      const matches = teams.teams.filter(
        (team) => team?.name === expectedTeamName && team?.slug === expectedTeamSlug,
      );
      if (matches.length !== 1 || typeof matches[0].id !== "string") fail();
      const teamId = matches[0].id;
      const projects = {};
      for (const kind of ["api", "web"]) {
        projects[kind] = parseProject(
          await requestJson({
            fetch_,
            stage: `release-project-${kind}`,
            token,
            url: projectUrl(projectSpecifications[kind].name, teamId),
          }),
          kind,
          teamId,
        );
      }
      if (projects.api.id === projects.web.id || projects.api.repoId !== projects.web.repoId)
        fail();
      return Object.freeze({ projects: Object.freeze(projects), teamId });
    })();
    return scopePromise;
  }

  async function readConfiguration() {
    const { teamId } = await scope();
    const variables = listedConfiguration(
      await requestJson({
        fetch_,
        stage: "release-api-environment",
        token,
        url: urlFor(`/v10/projects/${projectSpecifications.api.name}/env`, { teamId }),
      }),
    );
    if (variables === undefined) return false;
    for (const { desired, id } of variables) {
      const variable = await requestJson({
        fetch_,
        stage: "release-api-environment-value",
        token,
        url: urlFor(
          `/v1/projects/${projectSpecifications.api.name}/env/${encodeURIComponent(id)}`,
          { teamId },
        ),
      });
      if (!exactDecryptedProductionVariable(variable, desired, id)) return false;
    }
    return true;
  }

  async function list({ kind, query }) {
    const { projects, teamId } = await scope();
    const response = await requestJson({
      fetch_,
      stage: `release-deployments-${kind}`,
      token,
      url: urlFor("/v7/deployments", {
        projectId: projects[kind].id,
        ...query,
        teamId,
      }),
    });
    if (
      !Array.isArray(response.deployments) ||
      !record(response.pagination) ||
      response.pagination.count !== response.deployments.length ||
      response.pagination.next !== null
    ) {
      fail();
    }
    return response.deployments;
  }

  async function noInFlight() {
    for (const kind of ["api", "web"]) {
      for (const state of inFlightStates) {
        if ((await list({ kind, query: { limit: 1, state } })).length !== 0) return false;
      }
    }
    return true;
  }

  async function find({ candidateSha, kind, releaseAttemptId, releaseId }) {
    if (!validDeploymentIdentity({ candidateSha, kind, releaseAttemptId, releaseId })) fail();
    const { projects } = await scope();
    const raw = await list({
      kind,
      query: { branch: hostedReleaseBranch, limit: 20, sha: candidateSha, target: "production" },
    });
    const matches = raw.filter(
      (deployment) =>
        deployment?.meta?.huayiCandidateSha === candidateSha &&
        deployment?.meta?.huayiReleaseAttemptId === releaseAttemptId &&
        deployment?.meta?.huayiReleaseId === releaseId,
    );
    if (matches.length > 1) fail();
    return matches.length === 0
      ? undefined
      : parseDeployment(
          matches[0],
          kind,
          candidateSha,
          releaseAttemptId,
          releaseId,
          projects[kind].id,
        );
  }

  return Object.freeze({
    async inspect() {
      try {
        await scope();
        return Object.freeze({
          configurationReady: await readConfiguration(),
          noInFlightDeployments: await noInFlight(),
          projectsReady: true,
        });
      } catch {
        fail();
      }
    },
    async configure() {
      try {
        const { teamId } = await scope();
        if (!(await noInFlight())) fail();
        await requestJson({
          body: desiredEnvironment,
          fetch_,
          method: "POST",
          stage: "release-configure-api",
          token,
          url: urlFor(`/v10/projects/${projectSpecifications.api.name}/env`, {
            teamId,
            upsert: true,
          }),
        });
        if (!(await readConfiguration())) fail();
      } catch {
        fail();
      }
    },
    find,
    async create({ candidateSha, kind, releaseAttemptId, releaseId }) {
      try {
        if (!validDeploymentIdentity({ candidateSha, kind, releaseAttemptId, releaseId })) fail();
        if (!(await readConfiguration()) || !(await noInFlight())) fail();
        const { projects, teamId } = await scope();
        const response = await requestJson({
          body: {
            gitSource: {
              ref: hostedReleaseBranch,
              repoId: projects[kind].repoId,
              sha: candidateSha,
              type: "github",
            },
            meta: {
              huayiCandidateSha: candidateSha,
              huayiReleaseAttemptId: releaseAttemptId,
              huayiReleaseId: releaseId,
            },
            name: projects[kind].name,
            project: projects[kind].id,
            target: "production",
          },
          fetch_,
          method: "POST",
          stage: `release-create-${kind}`,
          token,
          url: urlFor("/v13/deployments", { forceNew: 1, teamId }),
        });
        if (
          typeof response.id !== "string" ||
          !deploymentPattern.test(response.id) ||
          !deploymentStates.has(response.readyState) ||
          response.target !== "production"
        ) {
          fail();
        }
        return Object.freeze({ id: response.id, state: response.readyState });
      } catch {
        fail();
      }
    },
    async wait({ candidateSha, deploymentId, kind, releaseAttemptId, releaseId }) {
      try {
        if (!deploymentPattern.test(deploymentId)) fail();
        for (let attempt = 0; attempt < 241; attempt += 1) {
          const deployment = await find({
            candidateSha,
            kind,
            releaseAttemptId,
            releaseId,
          });
          if (deployment === undefined || deployment.id !== deploymentId) {
            await sleep(15_000);
            continue;
          }
          if (deployment.state === "READY") return deployment;
          if (!["BUILDING", "INITIALIZING", "QUEUED"].includes(deployment.state)) fail();
          await sleep(15_000);
        }
        fail();
      } catch {
        fail();
      }
    },
    attest: runtime.attest,
  });
}
