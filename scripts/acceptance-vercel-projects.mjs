import { pathToFileURL } from "node:url";

const apiOrigin = "https://api.vercel.com";
const expectedTeamName = "neil0619's projects";
const expectedTeamSlug = "neil0619s-projects";
const maximumResponseBytes = 1_000_000;

export const vercelProjectsApplyConfirmation = "--confirm-vercel-empty-projects-neil0619s-projects";
export const vercelProjectsStatusArgument = "--status-vercel-empty-projects-neil0619s-projects";

export const vercelProjectSpecifications = Object.freeze([
  Object.freeze({
    name: "seen-said-acceptance-api",
    settings: Object.freeze({
      buildCommand: null,
      framework: "hono",
      nodeVersion: "22.x",
      outputDirectory: null,
      previewDeploymentsDisabled: true,
      resourceConfig: Object.freeze({
        fluid: true,
        functionDefaultRegions: Object.freeze(["sin1"]),
        functionDefaultTimeout: 120,
      }),
      rootDirectory: "apps/api",
      sourceFilesOutsideRootDirectory: true,
    }),
  }),
  Object.freeze({
    name: "seen-said-acceptance-web",
    settings: Object.freeze({
      buildCommand: "pnpm build",
      framework: "vite",
      nodeVersion: "22.x",
      outputDirectory: "dist",
      previewDeploymentsDisabled: true,
      rootDirectory: "apps/web",
      sourceFilesOutsideRootDirectory: true,
    }),
  }),
]);

export function renderVercelProjectPlan() {
  return [
    "Vercel hosted acceptance empty-project plan (offline / zero write)",
    `Scope: ${expectedTeamName} | ${expectedTeamSlug}`,
    "Projects:",
    "- seen-said-acceptance-api | apps/api | hono | 22.x | sin1 | Fluid | 120s",
    "- seen-said-acceptance-web | apps/web | vite | 22.x | pnpm build | dist",
    "REST contract:",
    "- GET /v2/teams resolves the exact token-scoped team.",
    "- POST /v11/projects creates name-only project shells without gitRepository.",
    "- PATCH /v9/projects/{idOrName} freezes supported project settings.",
    "- GET /v7/deployments proves each project remains empty before and after PATCH.",
    "- Preview Deployments disabled is requested through the official project field.",
    "Dashboard gates before Git connection:",
    "- Production Branch: codex/settings-configuration",
    "- Preview Deployments disabled: Dashboard readback required",
    "- Production-only environment variables remain pending for the later secret stage.",
    "No Git link, deployment, domain, environment variable, or secret is created.",
    "VERCEL_TOKEN is read only by apply/status and is never printed or persisted.",
    "",
  ].join("\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireToken(environment) {
  const token = environment.VERCEL_TOKEN;
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 4_096 ||
    token.trim() !== token ||
    /[\r\n\0]/u.test(token)
  ) {
    throw new Error("Vercel token is unavailable.");
  }
  return token;
}

function urlFor(pathname, query = {}) {
  const url = new URL(pathname, apiOrigin);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  return url.href;
}

async function requestJson({ allowNotFound = false, body, fetch_, method = "GET", token, url }) {
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch_(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
    });
  } catch {
    throw new Error("Vercel REST request failed.");
  }
  if (allowNotFound && response.status === 404) return undefined;
  if (!response.ok) throw new Error("Vercel REST request failed.");
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error("Vercel REST response failed.");
  }
  if (text.length === 0 || text.length > maximumResponseBytes) {
    throw new Error("Vercel REST response failed.");
  }
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("Vercel REST response failed.");
  }
}

async function resolveTeam({ fetch_, token }) {
  const response = await requestJson({
    fetch_,
    token,
    url: urlFor("/v2/teams", { limit: 100 }),
  });
  if (!Array.isArray(response.teams)) throw new Error("Vercel team scope failed.");
  const matches = response.teams.filter(
    (team) => isRecord(team) && team.slug === expectedTeamSlug && team.name === expectedTeamName,
  );
  if (matches.length !== 1 || typeof matches[0].id !== "string" || matches[0].id.length === 0) {
    throw new Error("Vercel team scope failed.");
  }
  return matches[0].id;
}

function projectUrl(name, teamId) {
  return urlFor(`/v9/projects/${encodeURIComponent(name)}`, { teamId });
}

async function readProject({ fetch_, name, teamId, token }) {
  return requestJson({
    allowNotFound: true,
    fetch_,
    token,
    url: projectUrl(name, teamId),
  });
}

function assertSafeProjectIdentity(project, specification, teamId) {
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    !project.id.startsWith("prj_") ||
    project.accountId !== teamId ||
    project.name !== specification.name ||
    (project.link !== undefined && project.link !== null) ||
    project.hasDeployments === true ||
    project.hasActiveBranches === true ||
    project.live === true ||
    (project.alias !== undefined &&
      (!Array.isArray(project.alias) || project.alias.length !== 0)) ||
    (project.env !== undefined && (!Array.isArray(project.env) || project.env.length !== 0)) ||
    (project.customEnvironments !== undefined &&
      (!Array.isArray(project.customEnvironments) || project.customEnvironments.length !== 0)) ||
    (project.integrations !== undefined &&
      (!Array.isArray(project.integrations) || project.integrations.length !== 0)) ||
    (project.latestDeployments !== undefined &&
      (!Array.isArray(project.latestDeployments) || project.latestDeployments.length !== 0))
  ) {
    throw new Error("Vercel project preflight failed.");
  }
}

async function assertNoDeployments({ fetch_, projectId, teamId, token }) {
  const response = await requestJson({
    fetch_,
    token,
    url: urlFor("/v7/deployments", { projectId, limit: 1, teamId }),
  });
  if (!Array.isArray(response.deployments) || response.deployments.length !== 0) {
    throw new Error("Vercel project preflight failed.");
  }
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function matchesSetting(actual, expected) {
  return expected === null ? actual == null : actual === expected;
}

function matchesDesiredSettings(project, settings) {
  if (
    !matchesSetting(project.buildCommand, settings.buildCommand) ||
    project.framework !== settings.framework ||
    project.nodeVersion !== settings.nodeVersion ||
    !matchesSetting(project.outputDirectory, settings.outputDirectory) ||
    project.rootDirectory !== settings.rootDirectory ||
    project.sourceFilesOutsideRootDirectory !== true ||
    (project.previewDeploymentsDisabled !== undefined &&
      project.previewDeploymentsDisabled !== true)
  ) {
    return false;
  }
  if (settings.resourceConfig === undefined) return true;
  const resource = project.resourceConfig;
  return (
    isRecord(resource) &&
    resource.fluid === settings.resourceConfig.fluid &&
    resource.functionDefaultTimeout === settings.resourceConfig.functionDefaultTimeout &&
    sameArray(resource.functionDefaultRegions, settings.resourceConfig.functionDefaultRegions)
  );
}

function isBlankShell(project) {
  return (
    project.buildCommand == null &&
    project.framework == null &&
    project.outputDirectory == null &&
    project.rootDirectory == null &&
    project.sourceFilesOutsideRootDirectory !== true &&
    project.previewDeploymentsDisabled !== true
  );
}

function classifyProject(project, specification) {
  if (matchesDesiredSettings(project, specification.settings)) return "desired";
  if (isBlankShell(project)) return "blank";
  throw new Error("Vercel project preflight failed.");
}

async function inspectProjects({ fetch_, teamId, token }) {
  const inspections = [];
  for (const specification of vercelProjectSpecifications) {
    const project = await readProject({ fetch_, name: specification.name, teamId, token });
    if (project === undefined) {
      inspections.push({ project: undefined, specification, state: "missing" });
      continue;
    }
    assertSafeProjectIdentity(project, specification, teamId);
    await assertNoDeployments({ fetch_, projectId: project.id, teamId, token });
    inspections.push({ project, specification, state: classifyProject(project, specification) });
  }
  return inspections;
}

async function createBlankShell({ fetch_, specification, teamId, token }) {
  const project = await requestJson({
    body: { name: specification.name },
    fetch_,
    method: "POST",
    token,
    url: urlFor("/v11/projects", { teamId }),
  });
  assertSafeProjectIdentity(project, specification, teamId);
  if (!isBlankShell(project)) throw new Error("Vercel project preflight failed.");
  await assertNoDeployments({ fetch_, projectId: project.id, teamId, token });
  return project;
}

async function freezeAndVerify({ fetch_, specification, teamId, token }) {
  await requestJson({
    body: specification.settings,
    fetch_,
    method: "PATCH",
    token,
    url: projectUrl(specification.name, teamId),
  });
  const project = await readProject({ fetch_, name: specification.name, teamId, token });
  assertSafeProjectIdentity(project, specification, teamId);
  if (!matchesDesiredSettings(project, specification.settings)) {
    throw new Error("Vercel project verification failed.");
  }
  await assertNoDeployments({ fetch_, projectId: project.id, teamId, token });
}

export async function applyVercelProjectShells({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
} = {}) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "apply" ||
    arguments_[1] !== vercelProjectsApplyConfirmation
  ) {
    throw new Error("Vercel empty project arguments are invalid.");
  }
  const token = requireToken(environment);
  const teamId = await resolveTeam({ fetch_, token });
  const inspections = await inspectProjects({ fetch_, teamId, token });
  for (const inspection of inspections) {
    if (inspection.state === "missing") {
      await createBlankShell({ fetch_, specification: inspection.specification, teamId, token });
    }
    await freezeAndVerify({ fetch_, specification: inspection.specification, teamId, token });
  }
  return {
    outcome: "applied",
    projects: vercelProjectSpecifications.map(({ name }) => ({
      name,
      state: "settings-ready-dashboard-pending",
    })),
  };
}

async function readVercelProjectStatus({ arguments_, environment, fetch_ }) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "status" ||
    arguments_[1] !== vercelProjectsStatusArgument
  ) {
    throw new Error("Vercel empty project arguments are invalid.");
  }
  const token = requireToken(environment);
  const teamId = await resolveTeam({ fetch_, token });
  const inspections = await inspectProjects({ fetch_, teamId, token });
  return inspections.map(({ specification, state }) => ({
    name: specification.name,
    state:
      state === "desired"
        ? "settings-ready-dashboard-pending"
        : state === "blank"
          ? "shell-unconfigured"
          : "missing",
  }));
}

export async function runVercelProjectsCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length === 1 && arguments_[0] === "plan") {
      writeOutput(renderVercelProjectPlan());
      return 0;
    }
    if (arguments_[0] === "apply") {
      await applyVercelProjectShells({ arguments_, environment, fetch_ });
      writeOutput(
        "Vercel empty project bootstrap completed; zero deployments verified. Dashboard verification is pending.\n",
      );
      return 0;
    }
    const statuses = await readVercelProjectStatus({ arguments_, environment, fetch_ });
    writeOutput(
      [
        "Vercel empty project status:",
        ...statuses.map(({ name, state }) => `- ${name}: ${state}`),
        "",
      ].join("\n"),
    );
    return 0;
  } catch {
    writeError("Vercel empty project operation failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runVercelProjectsCli();
}
