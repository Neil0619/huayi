import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyVercelProjectShells,
  runVercelProjectsCli,
  vercelProjectsApplyConfirmation,
  vercelProjectsStatusArgument,
} from "./acceptance-vercel-projects.mjs";
import {
  blankProject,
  configuredProject,
  configureExpectations,
  createFakeFetch,
  deploymentEmpty,
  deploymentUrl,
  jsonResponse,
  missingProjectExpectation,
  platformDefaultBlankProject,
  projectUrl,
  specs,
  teamId,
  teamQuery,
  teamResponse,
  token,
} from "./acceptance-vercel-projects-test-support.mjs";

test("status is read-only and reports only bounded safe states", async () => {
  const fake = createFakeFetch([
    { response: teamResponse(), url: teamQuery },
    {
      response: configuredProject("seen-said-acceptance-api"),
      url: projectUrl("seen-said-acceptance-api"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-api") },
    missingProjectExpectation("seen-said-acceptance-web"),
  ]);
  let stdout = "";
  const code = await runVercelProjectsCli({
    arguments_: ["status", vercelProjectsStatusArgument],
    environment: { VERCEL_TOKEN: token },
    fetch_: fake.fetch_,
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(
    stdout,
    "Vercel empty project status:\n" +
      "- seen-said-acceptance-api: settings-ready-dashboard-pending\n" +
      "- seen-said-acceptance-web: missing\n",
  );
  assert.equal(
    fake.calls.every((call) => call.method === "GET"),
    true,
  );
  assert.doesNotMatch(stdout, /team_|prj_|dpl_|vercel-test-token/u);
  fake.done();
});

test("confirmation, token, team identity, and remote errors fail without secret reflection", async () => {
  let calls = 0;
  await assert.rejects(
    applyVercelProjectShells({
      arguments_: ["apply", "--wrong"],
      environment: { VERCEL_TOKEN: token },
      fetch_: async () => {
        calls += 1;
      },
    }),
    /arguments are invalid/u,
  );
  await assert.rejects(
    applyVercelProjectShells({
      arguments_: ["apply", vercelProjectsApplyConfirmation],
      environment: { VERCEL_TOKEN: "bad\ntoken" },
      fetch_: async () => {
        calls += 1;
      },
    }),
    /token is unavailable/u,
  );
  assert.equal(calls, 0);

  const remoteSecret = "remote-body-must-not-be-reflected";
  let stdout = "";
  let stderr = "";
  const code = await runVercelProjectsCli({
    arguments_: ["apply", vercelProjectsApplyConfirmation],
    environment: { VERCEL_TOKEN: token },
    fetch_: async () => jsonResponse(500, { error: { message: remoteSecret }, token }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(
    stderr,
    "Vercel empty project operation failed: stage=resolve-team; reason=request-rejected; status=500.\n",
  );
  assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(`${token}|${remoteSecret}`, "u"));

  const wrongTeam = createFakeFetch([
    {
      response: {
        pagination: { count: 1, next: null, prev: null },
        teams: [{ id: "team_other", name: "Other", slug: "other" }],
      },
      url: teamQuery,
    },
  ]);
  await assert.rejects(
    applyVercelProjectShells({
      arguments_: ["apply", vercelProjectsApplyConfirmation],
      environment: { VERCEL_TOKEN: token },
      fetch_: wrongTeam.fetch_,
    }),
    /team scope failed/u,
  );
  wrongTeam.done();
});

test("the documented pnpm separator reaches apply without changing the confirmation", async () => {
  const fake = createFakeFetch([
    { response: teamResponse(), url: teamQuery },
    missingProjectExpectation("seen-said-acceptance-api"),
    missingProjectExpectation("seen-said-acceptance-web"),
    ...configureExpectations("seen-said-acceptance-api"),
    ...configureExpectations("seen-said-acceptance-web"),
  ]);
  let stderr = "";
  let stdout = "";
  const code = await runVercelProjectsCli({
    arguments_: ["apply", "--", vercelProjectsApplyConfirmation],
    environment: { VERCEL_TOKEN: token },
    fetch_: fake.fetch_,
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "Vercel empty project bootstrap completed; zero deployments verified. Dashboard verification is pending.\n",
  );
  fake.done();
});

test("CLI failures expose only bounded stage, reason, and HTTP status", async () => {
  const remoteSecret = "remote-detail-must-not-be-reflected";
  let stderr = "";
  const code = await runVercelProjectsCli({
    arguments_: ["apply", "--", vercelProjectsApplyConfirmation],
    environment: { VERCEL_TOKEN: token },
    fetch_: async () => jsonResponse(403, { error: { message: remoteSecret }, token }),
    writeError: (value) => {
      stderr += value;
    },
  });

  assert.equal(code, 1);
  assert.equal(
    stderr,
    "Vercel empty project operation failed: stage=resolve-team; reason=request-rejected; status=403.\n",
  );
  assert.doesNotMatch(stderr, new RegExp(`${token}|${remoteSecret}|https?://|Bearer`, "u"));
});

test("a partial write stops immediately and a rerun can resume from the blank shell", async () => {
  const first = createFakeFetch([
    { response: teamResponse(), url: teamQuery },
    missingProjectExpectation("seen-said-acceptance-api"),
    missingProjectExpectation("seen-said-acceptance-web"),
    {
      body: { name: "seen-said-acceptance-api" },
      method: "POST",
      response: blankProject("seen-said-acceptance-api"),
      url: `https://api.vercel.com/v11/projects?teamId=${teamId}`,
    },
    {
      response: platformDefaultBlankProject("seen-said-acceptance-api"),
      url: projectUrl("seen-said-acceptance-api"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-api") },
    {
      body: specs["seen-said-acceptance-api"].settings,
      method: "PATCH",
      response: { error: { message: "do not reflect" } },
      status: 500,
      url: projectUrl("seen-said-acceptance-api"),
    },
  ]);
  await assert.rejects(
    applyVercelProjectShells({
      arguments_: ["apply", vercelProjectsApplyConfirmation],
      environment: { VERCEL_TOKEN: token },
      fetch_: first.fetch_,
    }),
    /request failed/u,
  );
  first.done();

  const rerun = createFakeFetch([
    { response: teamResponse(), url: teamQuery },
    {
      response: platformDefaultBlankProject("seen-said-acceptance-api"),
      url: projectUrl("seen-said-acceptance-api"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-api") },
    missingProjectExpectation("seen-said-acceptance-web"),
    {
      body: specs["seen-said-acceptance-api"].settings,
      method: "PATCH",
      response: configuredProject("seen-said-acceptance-api"),
      url: projectUrl("seen-said-acceptance-api"),
    },
    {
      response: configuredProject("seen-said-acceptance-api"),
      url: projectUrl("seen-said-acceptance-api"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-api") },
    ...configureExpectations("seen-said-acceptance-web"),
  ]);
  const result = await applyVercelProjectShells({
    arguments_: ["apply", vercelProjectsApplyConfirmation],
    environment: { VERCEL_TOKEN: token },
    fetch_: rerun.fetch_,
  });
  assert.equal(result.outcome, "applied");
  rerun.done();
});
