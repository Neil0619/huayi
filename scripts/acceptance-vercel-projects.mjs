import { pathToFileURL } from "node:url";

import {
  expectedTeamName,
  expectedTeamSlug,
  renderVercelProjectPlan,
  vercelProjectSpecifications,
  vercelProjectsApplyConfirmation,
  vercelProjectsStatusArgument,
} from "./acceptance-vercel-projects-config.mjs";
import {
  normalizeForwardedArguments,
  operationError,
  renderOperationFailure,
} from "./acceptance-vercel-projects-diagnostics.mjs";
import { requestJson, urlFor } from "./acceptance-vercel-projects-http.mjs";

export {
  renderVercelProjectPlan,
  vercelProjectSpecifications,
  vercelProjectsApplyConfirmation,
  vercelProjectsStatusArgument,
};

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
    throw operationError("Vercel token is unavailable.", "credential", "token-unavailable");
  }
  return token;
}

async function resolveTeam({ fetch_, token }) {
  const response = await requestJson({
    fetch_,
    stage: "resolve-team",
    token,
    url: urlFor("/v2/teams", { limit: 100 }),
  });
  if (!Array.isArray(response.teams)) {
    throw operationError("Vercel team scope failed.", "resolve-team", "response-invalid", 200);
  }
  const matches = response.teams.filter(
    (team) => isRecord(team) && team.slug === expectedTeamSlug && team.name === expectedTeamName,
  );
  if (matches.length !== 1 || typeof matches[0].id !== "string" || matches[0].id.length === 0) {
    throw operationError("Vercel team scope failed.", "resolve-team", "scope-mismatch", 200);
  }
  return matches[0].id;
}

function projectUrl(name, teamId) {
  return urlFor(`/v9/projects/${encodeURIComponent(name)}`, { teamId });
}

async function readProject({ fetch_, name, stage, teamId, token }) {
  return requestJson({
    allowNotFound: true,
    fetch_,
    stage,
    token,
    url: projectUrl(name, teamId),
  });
}

function assertSafeProjectIdentity(project, specification, stage, teamId) {
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
    throw operationError("Vercel project preflight failed.", stage, "preflight-rejected");
  }
}

async function assertNoDeployments({ fetch_, projectId, stage, teamId, token }) {
  const response = await requestJson({
    fetch_,
    stage,
    token,
    url: urlFor("/v7/deployments", { projectId, limit: 1, teamId }),
  });
  if (!Array.isArray(response.deployments) || response.deployments.length !== 0) {
    throw operationError("Vercel project preflight failed.", stage, "preflight-rejected", 200);
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

function classifyProject(project, specification, stage) {
  if (matchesDesiredSettings(project, specification.settings)) return "desired";
  if (isBlankShell(project)) return "blank";
  throw operationError("Vercel project preflight failed.", stage, "preflight-rejected");
}

function projectKind(specification) {
  return specification.name.endsWith("-api") ? "api" : "web";
}

async function inspectProjects({ fetch_, teamId, token }) {
  const inspections = [];
  for (const specification of vercelProjectSpecifications) {
    const kind = projectKind(specification);
    const stage = `inspect-${kind}`;
    const project = await readProject({
      fetch_,
      name: specification.name,
      stage,
      teamId,
      token,
    });
    if (project === undefined) {
      inspections.push({ project: undefined, specification, state: "missing" });
      continue;
    }
    assertSafeProjectIdentity(project, specification, stage, teamId);
    await assertNoDeployments({
      fetch_,
      projectId: project.id,
      stage: `verify-deployments-${kind}`,
      teamId,
      token,
    });
    inspections.push({
      project,
      specification,
      state: classifyProject(project, specification, stage),
    });
  }
  return inspections;
}

async function createBlankShell({ fetch_, specification, teamId, token }) {
  const kind = projectKind(specification);
  const stage = `create-${kind}`;
  const project = await requestJson({
    body: { name: specification.name },
    fetch_,
    method: "POST",
    stage,
    token,
    url: urlFor("/v11/projects", { teamId }),
  });
  assertSafeProjectIdentity(project, specification, stage, teamId);
  if (!isBlankShell(project)) {
    throw operationError("Vercel project preflight failed.", stage, "preflight-rejected");
  }
  await assertNoDeployments({
    fetch_,
    projectId: project.id,
    stage: `verify-deployments-${kind}`,
    teamId,
    token,
  });
  return project;
}

async function freezeAndVerify({ fetch_, specification, teamId, token }) {
  const kind = projectKind(specification);
  await requestJson({
    body: specification.settings,
    fetch_,
    method: "PATCH",
    stage: `configure-${kind}`,
    token,
    url: projectUrl(specification.name, teamId),
  });
  const verifyStage = `verify-${kind}`;
  const project = await readProject({
    fetch_,
    name: specification.name,
    stage: verifyStage,
    teamId,
    token,
  });
  assertSafeProjectIdentity(project, specification, verifyStage, teamId);
  if (!matchesDesiredSettings(project, specification.settings)) {
    throw operationError("Vercel project verification failed.", verifyStage, "verification-failed");
  }
  await assertNoDeployments({
    fetch_,
    projectId: project.id,
    stage: `verify-deployments-${kind}`,
    teamId,
    token,
  });
}

export async function applyVercelProjectShells({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
} = {}) {
  arguments_ = normalizeForwardedArguments(arguments_);
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "apply" ||
    arguments_[1] !== vercelProjectsApplyConfirmation
  ) {
    throw operationError(
      "Vercel empty project arguments are invalid.",
      "input",
      "invalid-arguments",
    );
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
  arguments_ = normalizeForwardedArguments(arguments_);
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "status" ||
    arguments_[1] !== vercelProjectsStatusArgument
  ) {
    throw operationError(
      "Vercel empty project arguments are invalid.",
      "input",
      "invalid-arguments",
    );
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
    arguments_ = normalizeForwardedArguments(arguments_);
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
  } catch (error) {
    writeError(renderOperationFailure(error));
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runVercelProjectsCli();
}
