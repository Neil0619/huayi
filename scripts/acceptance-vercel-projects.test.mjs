import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyVercelProjectShells,
  renderVercelProjectPlan,
  runVercelProjectsCli,
  vercelProjectsApplyConfirmation,
} from "./acceptance-vercel-projects.mjs";
import {
  blankProject,
  configuredProject,
  configureExpectations,
  createProjectResponse,
  createFakeFetch,
  deploymentEmpty,
  deploymentUrl,
  missingProjectExpectation,
  platformDefaultBlankProject,
  projectUrl,
  specs,
  teamId,
  teamQuery,
  teamResponse,
  token,
} from "./acceptance-vercel-projects-test-support.mjs";

test("Vercel project plan is offline, deterministic, and secret independent", async () => {
  let calls = 0;
  let stdout = "";
  const plan = renderVercelProjectPlan();
  const code = await runVercelProjectsCli({
    arguments_: ["plan"],
    environment: {},
    readCredential: async () => token,
    fetch_: async () => {
      calls += 1;
      throw new Error("network forbidden");
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stdout, plan);
  for (const expected of [
    "neil0619s-projects",
    "POST /v11/projects",
    "PATCH /v9/projects/{idOrName}",
    "GET /v7/deployments",
    "seen-said-acceptance-api | apps/api | hono | 22.x",
    "seen-said-acceptance-web | apps/web | vite | 22.x",
    "Before Git: Settings -> Environments -> Preview must read Disabled",
    "Connect API then Web; prove zero deployments after each connection",
    "After Git: Production Branch Tracking must be codex/settings-configuration",
    "Prove zero deployments again after each Production Branch save",
    "No Git link, deployment, domain, environment variable, or secret is created",
    "Historical bootstrap-only tool; the current acceptance projects are non-empty",
    "Do not run apply or status against the current deployed projects",
  ]) {
    assert.match(plan, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(plan, new RegExp(token, "u"));
});

test("apply creates two name-only shells, freezes settings, rereads, and proves zero deployments", async () => {
  const fake = createFakeFetch([
    { response: teamResponse(), url: teamQuery },
    missingProjectExpectation("seen-said-acceptance-api"),
    missingProjectExpectation("seen-said-acceptance-web"),
    ...configureExpectations("seen-said-acceptance-api"),
    ...configureExpectations("seen-said-acceptance-web"),
  ]);

  const result = await applyVercelProjectShells({
    arguments_: ["apply", vercelProjectsApplyConfirmation],
    environment: {},
    readCredential: async () => token,
    fetch_: fake.fetch_,
  });

  assert.deepEqual(result, {
    outcome: "applied",
    projects: [
      { name: "seen-said-acceptance-api", state: "settings-ready-dashboard-pending" },
      { name: "seen-said-acceptance-web", state: "settings-ready-dashboard-pending" },
    ],
  });
  assert.equal(
    fake.calls.some((call) => call.method === "POST" && /deployments/u.test(call.url)),
    false,
  );
  assert.equal(
    fake.calls.some((call) =>
      call.body === undefined ? false : JSON.stringify(call.body).includes("gitRepository"),
    ),
    false,
  );
  fake.done();
});

test("apply rereads a created shell and accepts Vercel's safe source-outside-root default", async () => {
  const name = "seen-said-acceptance-api";
  const fake = createFakeFetch([
    { response: teamResponse(), url: teamQuery },
    missingProjectExpectation(name),
    {
      response: configuredProject("seen-said-acceptance-web"),
      url: projectUrl("seen-said-acceptance-web"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-web") },
    {
      body: { name },
      method: "POST",
      response: createProjectResponse(name),
      url: `https://api.vercel.com/v11/projects?teamId=${teamId}`,
    },
    { response: platformDefaultBlankProject(name), url: projectUrl(name) },
    { response: deploymentEmpty(), url: deploymentUrl(name) },
    {
      body: specs[name].settings,
      method: "PATCH",
      response: configuredProject(name),
      url: projectUrl(name),
    },
    { response: configuredProject(name), url: projectUrl(name) },
    { response: deploymentEmpty(), url: deploymentUrl(name) },
    {
      body: specs["seen-said-acceptance-web"].settings,
      method: "PATCH",
      response: configuredProject("seen-said-acceptance-web"),
      url: projectUrl("seen-said-acceptance-web"),
    },
    {
      response: configuredProject("seen-said-acceptance-web"),
      url: projectUrl("seen-said-acceptance-web"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-web") },
  ]);

  const result = await applyVercelProjectShells({
    arguments_: ["apply", vercelProjectsApplyConfirmation],
    environment: {},
    readCredential: async () => token,
    fetch_: fake.fetch_,
  });

  assert.equal(result.outcome, "applied");
  fake.done();
});

test("apply reuses exact shells without POST and safely repeats the settings PATCH", async () => {
  const expectations = [
    { response: teamResponse(), url: teamQuery },
    {
      response: configuredProject("seen-said-acceptance-api"),
      url: projectUrl("seen-said-acceptance-api"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-api") },
    {
      response: configuredProject("seen-said-acceptance-web"),
      url: projectUrl("seen-said-acceptance-web"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-web") },
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
    {
      body: specs["seen-said-acceptance-web"].settings,
      method: "PATCH",
      response: configuredProject("seen-said-acceptance-web"),
      url: projectUrl("seen-said-acceptance-web"),
    },
    {
      response: configuredProject("seen-said-acceptance-web"),
      url: projectUrl("seen-said-acceptance-web"),
    },
    { response: deploymentEmpty(), url: deploymentUrl("seen-said-acceptance-web") },
  ];
  const fake = createFakeFetch(expectations);

  await applyVercelProjectShells({
    arguments_: ["apply", vercelProjectsApplyConfirmation],
    environment: {},
    readCredential: async () => token,
    fetch_: fake.fetch_,
  });

  assert.equal(
    fake.calls.some((call) => call.method === "POST"),
    false,
  );
  fake.done();
});

test("preflight fails closed on drift, Git linkage, or any existing deployment", async (t) => {
  const unsafeProjects = [
    {
      label: "drift",
      project: { ...blankProject("seen-said-acceptance-api"), rootDirectory: "other" },
      deployments: deploymentEmpty(),
    },
    {
      label: "Git link",
      project: {
        ...configuredProject("seen-said-acceptance-api"),
        link: { org: "Neil0619", repo: "huayi", type: "github" },
      },
      deployments: null,
    },
    {
      label: "deployment",
      project: configuredProject("seen-said-acceptance-api"),
      deployments: {
        deployments: [{ uid: "dpl_existing" }],
        pagination: { count: 1, next: null, prev: null },
      },
    },
    {
      label: "existing environment",
      project: {
        ...configuredProject("seen-said-acceptance-api"),
        env: [{ key: "UNEXPECTED", target: ["production"] }],
      },
      deployments: null,
    },
    {
      label: "existing custom environment",
      project: {
        ...configuredProject("seen-said-acceptance-api"),
        customEnvironments: [{ id: "env_unexpected" }],
      },
      deployments: null,
    },
    {
      label: "existing alias",
      project: {
        ...configuredProject("seen-said-acceptance-api"),
        alias: ["unexpected.example"],
      },
      deployments: null,
    },
    {
      label: "existing integration",
      project: {
        ...configuredProject("seen-said-acceptance-api"),
        integrations: [{ id: "integration_unexpected" }],
      },
      deployments: null,
    },
  ];

  for (const unsafe of unsafeProjects) {
    await t.test(unsafe.label, async () => {
      const expectations = [
        { response: teamResponse(), url: teamQuery },
        { response: unsafe.project, url: projectUrl("seen-said-acceptance-api") },
        ...(unsafe.deployments === null
          ? []
          : [
              {
                response: unsafe.deployments,
                url: deploymentUrl("seen-said-acceptance-api"),
              },
            ]),
      ];
      const fake = createFakeFetch(expectations);
      await assert.rejects(
        applyVercelProjectShells({
          arguments_: ["apply", vercelProjectsApplyConfirmation],
          environment: {},
          readCredential: async () => token,
          fetch_: fake.fetch_,
        }),
        /Vercel project preflight failed/u,
      );
      assert.equal(
        fake.calls.some((call) => ["POST", "PATCH"].includes(call.method)),
        false,
      );
      fake.done();
    });
  }
});
