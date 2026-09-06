import assert from "node:assert/strict";
import test from "node:test";

import { createProductionReleaseVercel, productionTargets } from "./production-release-vercel.mjs";

const candidateSha = "a".repeat(40);
const attemptId = "b".repeat(32);
const releaseId = `production-${candidateSha}`;
const identity = { candidateSha, attemptId, releaseId, kind: "api" };
const environment = {
  api: { HUAYI_DEPLOYMENT_ENVIRONMENT: "production", HUAYI_API_ORIGIN: "https://api.seen-said.cn" },
  web: { VITE_DEPLOYMENT_ENVIRONMENT: "production", VITE_API_ORIGIN: "https://api.seen-said.cn" },
};

function fixture({
  mutate = () => undefined,
  failPost = false,
  recordFails = false,
  unconfigured = false,
} = {}) {
  const calls = [];
  const journal = new Set();
  const scope = productionTargets;
  const deployed = [];
  const configured = new Set(unconfigured ? [] : ["api", "web"]);
  const fetch_ = async (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    calls.push({
      path,
      method: init.method,
      ...(init.body ? { body: JSON.parse(init.body) } : {}),
    });
    let value;
    const kind = path.includes(scope.web.id) ? "web" : "api";
    const project = scope[kind];
    if (path.startsWith("/v2/teams/"))
      value = { id: scope.teamId, slug: scope.teamSlug, billing: { plan: "hobby" } };
    else if (path.endsWith("/domains"))
      value = {
        domains: [{ name: project.domain, verified: true, redirect: null }],
        pagination: { next: null },
      };
    else if (path.startsWith("/v9/projects/"))
      value = {
        id: project.id,
        accountId: scope.teamId,
        name: project.name,
        framework: project.framework,
        rootDirectory: project.rootDirectory,
        nodeVersion: "24.x",
        previewDeploymentsDisabled: true,
        link: null,
      };
    else if (path.endsWith("/env")) {
      if (init.method === "POST") {
        assert.equal(journal.has(`production-environment:${kind}`), true);
        assert.equal(parsed.searchParams.get("upsert"), "false");
        assert.ok(
          JSON.parse(init.body).every(
            (v) => v.type === "encrypted" && v.target.join() === "production",
          ),
        );
        configured.add(kind);
      }
      value = {
        envs: Object.entries(environment[kind]).map(([key, value]) => ({
          id: key,
          key,
          value,
          type: "encrypted",
          target: ["production"],
          gitBranch: null,
        })),
      };
      if (!configured.has(kind)) value.envs = [];
    } else if (path.includes("/env/")) {
      const key = path.split("/").at(-1);
      value = {
        id: key,
        key,
        value: environment[kind][key],
        type: "encrypted",
        target: ["production"],
        gitBranch: null,
        decrypted: true,
      };
    } else if (path === "/v7/deployments") {
      value = {
        deployments: parsed.searchParams.has("state") ? [] : deployed,
        pagination: { next: null },
      };
    } else if (path === "/v13/deployments") {
      assert.equal(journal.has(`${releaseId}:api`), true);
      if (failPost) throw new Error("private-provider-diagnostic");
      const body = JSON.parse(init.body);
      const raw = {
        uid: "dpl_production123",
        name: scope.api.name,
        projectId: scope.api.id,
        target: "production",
        readyState: "QUEUED",
        meta: { ...body.meta, githubCommitSha: candidateSha },
      };
      deployed.push(raw);
      value = { ...raw, id: raw.uid };
    } else throw new Error(`unexpected ${path}`);
    mutate(value, path);
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const recordAttempt = async (attempt) => {
    const key = `${attempt.releaseId}:${attempt.kind}`;
    if (recordFails || journal.has(key)) throw new Error("existing-attempt");
    journal.add(key);
  };
  const adapter = createProductionReleaseVercel({
    token: "offline-vercel-token",
    fetch_,
    environment,
    recordAttempt,
  });
  return { adapter, calls, journal };
}

test("deploys only the exact fixed production project and Git SHA after durable intent", async () => {
  const { adapter, calls } = fixture();
  const result = await adapter.create(identity);
  assert.equal(result.id, "dpl_production123");
  const post = calls.find(({ method }) => method === "POST");
  assert.equal(post.path, "/v13/deployments");
  assert.equal(post.body.project, productionTargets.api.id);
  assert.deepEqual(post.body.gitSource, {
    type: "github",
    repoId: 1297632474,
    ref: "codex/settings-configuration",
    sha: candidateSha,
  });
  assert.equal(post.body.projectSettings.rootDirectory, "apps/api");
  assert.equal(post.body.meta.huayiReleaseChannel, "production");
  assert.deepEqual(await adapter.find(identity), result);
  await assert.rejects(adapter.create(identity));
  assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
});

test("an uncertain deployment response is sanitized and never automatically replayed", async () => {
  const { adapter, calls } = fixture({ failPost: true });
  await assert.rejects(adapter.create(identity), {
    message: "Production release failed closed; reconcile recorded attempts before any retry.",
  });
  assert.equal(await adapter.find(identity), undefined);
  await assert.rejects(adapter.create(identity));
  assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
});

test("identity, preview-secret, competing-deployment and journal failures prevent all deployment writes", async () => {
  const changes = [
    (v, p) => {
      if (p.startsWith("/v9/projects/") && !p.endsWith("domains")) v.id = "prj_acceptance";
    },
    (v, p) => {
      if (p.endsWith("/env")) v.envs[0].target = ["production", "preview"];
    },
    (v, p) => {
      if (p.endsWith("/domains")) v.domains[0].name = "api.acceptance.seen-said.cn";
    },
    (v, p) => {
      if (p === "/v7/deployments") v.deployments = [{ uid: "dpl_other" }];
    },
  ];
  for (const mutate of changes) {
    const { adapter, calls } = fixture({ mutate });
    await assert.rejects(adapter.create(identity));
    assert.equal(
      calls.some(({ method }) => method === "POST"),
      false,
    );
  }
  const { adapter, calls } = fixture({ recordFails: true });
  await assert.rejects(adapter.create(identity));
  assert.equal(
    calls.some(({ method }) => method === "POST"),
    false,
  );
});

test("production release identity rejects acceptance IDs and malformed SHAs before network access", async () => {
  for (const changed of [
    { releaseId: `hosted-acceptance-${candidateSha}` },
    { candidateSha: "short" },
    { kind: "acceptance" },
    { attemptId: "../unsafe" },
  ]) {
    const { adapter, calls } = fixture();
    await assert.rejects(adapter.create({ ...identity, ...changed }));
    assert.equal(calls.length, 0);
  }
});

test("initial environment configuration writes encrypted production-only values once after exclusive intent", async () => {
  const { adapter, calls } = fixture({ unconfigured: true });
  assert.deepEqual(await adapter.initializeEnvironment({ kind: "api", attemptId }), {
    configured: true,
  });
  assert.deepEqual(await adapter.initializeEnvironment({ kind: "api", attemptId }), {
    configured: true,
  });
  assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
  assert.equal(
    calls.find(({ method }) => method === "POST").path,
    `/v10/projects/${productionTargets.api.id}/env`,
  );
});

test("initialization refuses to overwrite any partial or unexpected configuration", async () => {
  const { adapter, calls } = fixture({
    mutate: (v, path) => {
      if (path.endsWith("/env")) v.envs[0].target = ["preview"];
    },
  });
  await assert.rejects(adapter.initializeEnvironment({ kind: "api", attemptId }));
  assert.equal(
    calls.some(({ method }) => method === "POST"),
    false,
  );
});
