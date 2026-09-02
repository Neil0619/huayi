import assert from "node:assert/strict";
import test from "node:test";

import { createHostedReleaseVercel } from "./acceptance-hosted-release-vercel.mjs";

const candidateSha = "f".repeat(40);
const releaseId = `hosted-acceptance-${candidateSha}`;
const token = "fictional-vercel-token-value";
const teamId = "team_seen_said";
const projectIds = {
  api: "prj_seen_said_acceptance_api",
  web: "prj_seen_said_acceptance_web",
};
const deploymentIds = {
  api: "dpl_release_api_123",
  web: "dpl_release_web_123",
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function project(kind) {
  return {
    accountId: teamId,
    framework: kind === "api" ? "hono" : "vite",
    id: projectIds[kind],
    link: {
      org: "Neil0619",
      productionBranch: "codex/settings-configuration",
      repo: "huayi",
      repoId: 987654,
      type: "github",
    },
    name: `seen-said-acceptance-${kind}`,
    rootDirectory: `apps/${kind}`,
  };
}

function deployment(kind, state = "READY") {
  return {
    createdAt: 1_788_330_000_000,
    meta: {
      githubCommitSha: candidateSha,
      huayiCandidateSha: candidateSha,
      huayiReleaseId: releaseId,
    },
    name: `seen-said-acceptance-${kind}`,
    projectId: projectIds[kind],
    readyState: state,
    target: "production",
    uid: deploymentIds[kind],
  };
}

function harness() {
  const calls = [];
  const deployed = new Map();
  let configured = false;
  const fetch_ = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ body: init.body, headers: init.headers, method: init.method ?? "GET", url });
    if (url.origin === "https://api.vercel.com") {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (url.pathname === "/v2/teams") {
        return jsonResponse({
          pagination: { count: 1, next: null },
          teams: [{ id: teamId, name: "neil0619's projects", slug: "neil0619s-projects" }],
        });
      }
      const projectMatch = /^\/v9\/projects\/seen-said-acceptance-(api|web)$/u.exec(url.pathname);
      if (projectMatch !== null) return jsonResponse(project(projectMatch[1]));
      if (url.pathname === "/v10/projects/seen-said-acceptance-api/env") {
        if ((init.method ?? "GET") === "POST") {
          configured = true;
          return jsonResponse({ created: {}, failed: [] }, 201);
        }
        return jsonResponse({
          envs: [
            {
              id: "env_capability",
              key: "HUAYI_STORE_EXTENSION_CAPABILITY",
              target: ["production"],
              type: "encrypted",
            },
            ...(configured
              ? [
                  {
                    id: "env_extension_id",
                    key: "HUAYI_STORE_EXTENSION_ID",
                    target: ["production"],
                    type: "encrypted",
                  },
                ]
              : []),
            {
              id: "env_minimum",
              key: "HUAYI_MIN_SUPPORTED_EXTENSION_VERSION",
              target: ["production"],
              type: "encrypted",
            },
          ],
          hiddenProductionEnvCount: 0,
        });
      }
      const environmentMatch =
        /^\/v1\/projects\/seen-said-acceptance-api\/env\/(env_capability|env_extension_id|env_minimum)$/u.exec(
          url.pathname,
        );
      if (environmentMatch !== null) {
        const values = {
          env_capability: configured ? "enabled" : "disabled",
          env_extension_id: "hoijjhgcckfhbcefoclgbhkgninnkknd",
          env_minimum: "1.0.0",
        };
        const keys = {
          env_capability: "HUAYI_STORE_EXTENSION_CAPABILITY",
          env_extension_id: "HUAYI_STORE_EXTENSION_ID",
          env_minimum: "HUAYI_MIN_SUPPORTED_EXTENSION_VERSION",
        };
        return jsonResponse({
          decrypted: true,
          id: environmentMatch[1],
          key: keys[environmentMatch[1]],
          target: ["production"],
          type: "encrypted",
          value: values[environmentMatch[1]],
        });
      }
      if (url.pathname === "/v7/deployments") {
        const kind = url.searchParams.get("projectId") === projectIds.api ? "api" : "web";
        if (url.searchParams.has("state")) {
          return jsonResponse({ deployments: [], pagination: { count: 0, next: null } });
        }
        const item = deployed.get(kind);
        return jsonResponse({
          deployments: item === undefined ? [] : [item],
          pagination: { count: item === undefined ? 0 : 1, next: null },
        });
      }
      if (url.pathname === "/v13/deployments" && init.method === "POST") {
        const body = JSON.parse(init.body);
        const kind = body.project === projectIds.api ? "api" : "web";
        deployed.set(kind, deployment(kind));
        return jsonResponse({
          id: deploymentIds[kind],
          readyState: "QUEUED",
          target: "production",
        });
      }
    }
    if (url.href === "https://api.acceptance.seen-said.cn/health") {
      return new Response(JSON.stringify({ service: "huayi-cloud-api", status: "ok" }), {
        headers: {
          "content-type": "application/json",
          "x-huayi-deployment-commit": candidateSha,
          "x-huayi-deployment-id": deploymentIds.api,
          "x-huayi-release-channel": "hosted-acceptance",
        },
      });
    }
    if (url.href === "https://api.acceptance.seen-said.cn/v1/extension-pairings") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "chrome-extension://hoijjhgcckfhbcefoclgbhkgninnkknd",
          vary: "Origin",
        },
        status: 204,
      });
    }
    if (url.href === "https://app.acceptance.seen-said.cn/analysis") {
      return new Response(
        `<meta name="huayi-deployment-commit" content="${candidateSha}">` +
          `<meta name="huayi-deployment-id" content="${deploymentIds.web}">` +
          '<meta name="huayi-release-channel" content="hosted-acceptance">',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    throw new Error(`unexpected URL: ${url.href}`);
  };
  return { calls, fetch_ };
}

test("Vercel adapter upserts only the three fixed public API capability values", async () => {
  const { calls, fetch_ } = harness();
  const vercel = createHostedReleaseVercel({ fetch_, sleep: async () => undefined, token });

  assert.deepEqual(await vercel.inspect(), {
    configurationReady: false,
    noInFlightDeployments: true,
    projectsReady: true,
  });
  await vercel.configure();
  assert.equal((await vercel.inspect()).configurationReady, true);

  const write = calls.find(
    ({ method, url }) =>
      method === "POST" && url.pathname === "/v10/projects/seen-said-acceptance-api/env",
  );
  assert.equal(write.url.searchParams.get("upsert"), "true");
  assert.deepEqual(JSON.parse(write.body), [
    {
      key: "HUAYI_MIN_SUPPORTED_EXTENSION_VERSION",
      target: ["production"],
      type: "encrypted",
      value: "1.0.0",
    },
    {
      key: "HUAYI_STORE_EXTENSION_CAPABILITY",
      target: ["production"],
      type: "encrypted",
      value: "enabled",
    },
    {
      key: "HUAYI_STORE_EXTENSION_ID",
      target: ["production"],
      type: "encrypted",
      value: "hoijjhgcckfhbcefoclgbhkgninnkknd",
    },
  ]);
  assert.equal(write.body.includes(token), false);
  assert.equal(
    calls.some(
      ({ method, url }) =>
        method === "GET" &&
        url.pathname === "/v1/projects/seen-said-acceptance-api/env/env_extension_id",
    ),
    true,
  );
});

test("Vercel adapter creates and observes exact-SHA production deployments serially", async () => {
  const { calls, fetch_ } = harness();
  const vercel = createHostedReleaseVercel({ fetch_, sleep: async () => undefined, token });
  await vercel.configure();
  for (const kind of ["api", "web"]) {
    assert.equal(await vercel.find({ candidateSha, kind, releaseId }), undefined);
    const created = await vercel.create({ candidateSha, kind, releaseId });
    assert.equal(created.id, deploymentIds[kind]);
    assert.deepEqual(
      await vercel.wait({
        candidateSha,
        deploymentId: deploymentIds[kind],
        kind,
        releaseId,
      }),
      { id: deploymentIds[kind], state: "READY" },
    );
  }

  const writes = calls.filter(
    ({ method, url }) => method === "POST" && url.pathname === "/v13/deployments",
  );
  assert.deepEqual(
    writes.map(({ body }) => JSON.parse(body).gitSource),
    ["api", "web"].map(() => ({
      ref: "codex/settings-configuration",
      repoId: 987654,
      sha: candidateSha,
      type: "github",
    })),
  );
  assert.deepEqual(
    writes.map(({ body }) => JSON.parse(body).meta),
    ["api", "web"].map(() => ({ huayiCandidateSha: candidateSha, huayiReleaseId: releaseId })),
  );
});

test("Vercel postflight binds both runtime surfaces and the extension CORS origin", async () => {
  const { fetch_ } = harness();
  const vercel = createHostedReleaseVercel({ fetch_, token });
  await vercel.attest({
    apiDeploymentId: deploymentIds.api,
    candidateSha,
    webDeploymentId: deploymentIds.web,
  });
});
