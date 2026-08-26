import { expectedTeamName, expectedTeamSlug } from "./acceptance-vercel-projects-config.mjs";
import { requestJson, urlFor } from "./acceptance-vercel-projects-http.mjs";

const branch = "codex/settings-configuration";
const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentStates = new Set([
  "BUILDING",
  "CANCELED",
  "ERROR",
  "INITIALIZING",
  "QUEUED",
  "READY",
]);
const specifications = Object.freeze([
  Object.freeze({
    framework: "hono",
    kind: "api",
    name: "seen-said-acceptance-api",
    rootDirectory: "apps/api",
  }),
  Object.freeze({
    framework: "vite",
    kind: "web",
    name: "seen-said-acceptance-web",
    rootDirectory: "apps/web",
  }),
]);

function fail() {
  throw new Error("Hosted Vercel one-shot remote verification failed.");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireToken(token) {
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 4_096 ||
    token.trim() !== token ||
    /[\r\n\0]/u.test(token)
  ) {
    fail();
  }
}

async function resolveTeam({ fetch_, token }) {
  const response = await requestJson({
    fetch_,
    stage: "resolve-team",
    token,
    url: urlFor("/v2/teams", { limit: 100 }),
  });
  if (
    !Array.isArray(response.teams) ||
    !isRecord(response.pagination) ||
    response.pagination.count !== response.teams.length ||
    response.pagination.next !== null
  ) {
    fail();
  }
  const matches = response.teams.filter(
    (team) => isRecord(team) && team.name === expectedTeamName && team.slug === expectedTeamSlug,
  );
  if (
    matches.length !== 1 ||
    typeof matches[0].id !== "string" ||
    !/^team_[A-Za-z0-9_-]+$/u.test(matches[0].id)
  ) {
    fail();
  }
  return matches[0].id;
}

function assertProject(project, specification, teamId) {
  const link = project?.link;
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    !/^prj_[A-Za-z0-9_-]+$/u.test(project.id) ||
    project.accountId !== teamId ||
    project.name !== specification.name ||
    project.framework !== specification.framework ||
    project.rootDirectory !== specification.rootDirectory ||
    !isRecord(link) ||
    link.type !== "github" ||
    link.org !== "Neil0619" ||
    link.repo !== "huayi" ||
    link.productionBranch !== branch
  ) {
    fail();
  }
}

function parseDeployment(raw, specification, projectId) {
  const sha = raw?.meta?.githubCommitSha;
  if (
    !isRecord(raw) ||
    typeof raw.uid !== "string" ||
    !/^dpl_[A-Za-z0-9_-]{3,128}$/u.test(raw.uid) ||
    raw.name !== specification.name ||
    raw.projectId !== projectId ||
    raw.target !== "production" ||
    !deploymentStates.has(raw.readyState) ||
    !Number.isSafeInteger(raw.createdAt) ||
    raw.createdAt < 0 ||
    typeof sha !== "string" ||
    !commitPattern.test(sha)
  ) {
    fail();
  }
  return {
    createdAt: raw.createdAt,
    id: raw.uid,
    project: specification.kind,
    sha,
    state: raw.readyState,
  };
}

export async function readVercelOneShotSnapshot({ fetch_ = globalThis.fetch, token } = {}) {
  try {
    requireToken(token);
    const teamId = await resolveTeam({ fetch_, token });
    const snapshots = {};
    const projectIds = new Set();
    for (const specification of specifications) {
      const project = await requestJson({
        fetch_,
        stage: `inspect-${specification.kind}`,
        token,
        url: urlFor(`/v9/projects/${specification.name}`, { teamId }),
      });
      assertProject(project, specification, teamId);
      if (projectIds.has(project.id)) fail();
      projectIds.add(project.id);
      const response = await requestJson({
        fetch_,
        stage: `deployments-${specification.kind}`,
        token,
        url: urlFor("/v7/deployments", { projectId: project.id, limit: 100, teamId }),
      });
      if (
        !Array.isArray(response.deployments) ||
        !isRecord(response.pagination) ||
        response.pagination.count !== response.deployments.length ||
        response.pagination.next !== null
      ) {
        fail();
      }
      const deployments = response.deployments.map((raw) =>
        parseDeployment(raw, specification, project.id),
      );
      if (new Set(deployments.map(({ id }) => id)).size !== deployments.length) fail();
      deployments.sort(
        (left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id),
      );
      for (let index = 1; index < deployments.length; index += 1) {
        if (deployments[index - 1].createdAt === deployments[index].createdAt) fail();
      }
      snapshots[specification.kind] = deployments;
    }
    return { api: snapshots.api, web: snapshots.web };
  } catch {
    fail();
  }
}
