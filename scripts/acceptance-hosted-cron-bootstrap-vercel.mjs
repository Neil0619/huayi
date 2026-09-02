import { expectedTeamName, expectedTeamSlug } from "./acceptance-vercel-projects-config.mjs";
import { requestJson, urlFor } from "./acceptance-vercel-projects-http.mjs";

const apiProjectName = "seen-said-acceptance-api";
const environmentVariableIdPattern = /^[A-Za-z0-9_-]{1,256}$/u;

function fail() {
  throw new Error("Hosted Cron Vercel configuration failed.");
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactCronVariable(variable) {
  return (
    record(variable) &&
    typeof variable.id === "string" &&
    environmentVariableIdPattern.test(variable.id) &&
    variable.key === "CRON_SECRET" &&
    variable.type === "sensitive" &&
    Array.isArray(variable.target) &&
    variable.target.length === 1 &&
    variable.target[0] === "production" &&
    variable.gitBranch == null
  );
}

function exactUpsertResponse(response) {
  if (!record(response) || !Array.isArray(response.failed) || response.failed.length !== 0) {
    return false;
  }
  const created = Array.isArray(response.created) ? response.created : [response.created];
  return created.length === 1 && exactCronVariable(created[0]);
}

async function resolveVercelScope({ fetch_, token }) {
  const teams = await requestJson({
    fetch_,
    stage: "cron-bootstrap-team",
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
  const project = await requestJson({
    fetch_,
    stage: "cron-bootstrap-project",
    token,
    url: urlFor(`/v9/projects/${apiProjectName}`, { teamId }),
  });
  if (
    project.accountId !== teamId ||
    project.name !== apiProjectName ||
    typeof project.id !== "string" ||
    !/^prj_[A-Za-z0-9_-]+$/u.test(project.id)
  ) {
    fail();
  }
  return teamId;
}

export async function upsertHostedCronSecret({ cronSecret, fetch_, token }) {
  try {
    const teamId = await resolveVercelScope({ fetch_, token });
    const upserted = await requestJson({
      body: [
        {
          key: "CRON_SECRET",
          target: ["production"],
          type: "sensitive",
          value: cronSecret,
        },
      ],
      fetch_,
      method: "POST",
      stage: "cron-bootstrap-environment-upsert",
      token,
      url: urlFor(`/v10/projects/${apiProjectName}/env`, { teamId, upsert: true }),
    });
    if (!exactUpsertResponse(upserted)) fail();
    const listed = await requestJson({
      fetch_,
      stage: "cron-bootstrap-environment-readback",
      token,
      url: urlFor(`/v10/projects/${apiProjectName}/env`, { teamId }),
    });
    if (!Array.isArray(listed.envs)) fail();
    const matches = listed.envs.filter((variable) => variable?.key === "CRON_SECRET");
    if (matches.length !== 1 || !exactCronVariable(matches[0])) fail();
  } catch {
    fail();
  }
}
