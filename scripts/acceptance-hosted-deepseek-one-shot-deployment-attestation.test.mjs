import assert from "node:assert/strict";
import { test } from "node:test";

import { captureHostedDeepSeekDeploymentPair } from "./acceptance-hosted-deepseek-one-shot-deployment-attestation.mjs";

const token = "vercel-deployment-attestation-test-token";
const teamId = "team_seen_said_acceptance";
const apiProjectId = "prj_seen_said_acceptance_api";
const webProjectId = "prj_seen_said_acceptance_web";
const apiCommit = "1".repeat(40);
const webCommit = "2".repeat(40);
const apiDeploymentId = "dpl_apiCandidate001";
const webDeploymentId = "dpl_webCandidate001";

function response(status, body, headers = {}) {
  return {
    headers: new Headers(headers),
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function jsonResponse(body, status = 200) {
  return response(status, JSON.stringify(body), { "content-type": "application/json" });
}

function rawDeployment({ createdAt, id, projectId, projectName, sha, state = "READY" }) {
  return {
    createdAt,
    meta: { githubCommitSha: sha },
    name: projectName,
    projectId,
    readyState: state,
    target: "production",
    uid: id,
  };
}

function project({ framework, id, name, rootDirectory }) {
  return {
    accountId: teamId,
    framework,
    id,
    link: {
      org: "Neil0619",
      productionBranch: "codex/settings-configuration",
      repo: "huayi",
      type: "github",
    },
    name,
    rootDirectory,
  };
}

function fixture({
  apiState = "READY",
  runtimeApiCommit = apiCommit,
  runtimeApiContentType = "application/json; charset=UTF-8",
  runtimeWebContentType = "text/html; charset=utf-8",
} = {}) {
  const apiHistory = [
    rawDeployment({
      createdAt: 200,
      id: "dpl_api-canceled-audit",
      projectId: apiProjectId,
      projectName: "seen-said-acceptance-api",
      sha: "3".repeat(40),
      state: "CANCELED",
    }),
    rawDeployment({
      createdAt: 100,
      id: apiDeploymentId,
      projectId: apiProjectId,
      projectName: "seen-said-acceptance-api",
      sha: apiCommit,
      state: apiState,
    }),
  ];
  const webHistory = [
    rawDeployment({
      createdAt: 100,
      id: webDeploymentId,
      projectId: webProjectId,
      projectName: "seen-said-acceptance-web",
      sha: webCommit,
    }),
  ];
  return [
    jsonResponse({
      pagination: { count: 1, next: null, prev: null },
      teams: [{ id: teamId, name: "neil0619's projects", slug: "neil0619s-projects" }],
    }),
    jsonResponse(
      project({
        framework: "hono",
        id: apiProjectId,
        name: "seen-said-acceptance-api",
        rootDirectory: "apps/api",
      }),
    ),
    jsonResponse({
      deployments: apiHistory,
      pagination: { count: apiHistory.length, next: null, prev: null },
    }),
    jsonResponse(
      project({
        framework: "vite",
        id: webProjectId,
        name: "seen-said-acceptance-web",
        rootDirectory: "apps/web",
      }),
    ),
    jsonResponse({
      deployments: webHistory,
      pagination: { count: webHistory.length, next: null, prev: null },
    }),
    response(200, JSON.stringify({ service: "huayi-cloud-api", status: "ok" }), {
      "content-type": runtimeApiContentType,
      "x-huayi-deployment-commit": runtimeApiCommit,
      "x-huayi-deployment-id": apiDeploymentId,
      "x-huayi-release-channel": "hosted-acceptance",
    }),
    response(
      200,
      `<!doctype html><html><head>
        <meta name="huayi-deployment-commit" content="${webCommit}">
        <meta name="huayi-deployment-id" content="${webDeploymentId}">
        <meta name="huayi-release-channel" content="hosted-acceptance">
      </head><body><div id="root"></div></body></html>`,
      { "content-type": runtimeWebContentType },
    ),
  ];
}

function fakeFetch(responses) {
  const calls = [];
  return {
    calls,
    fetch_: async (url, init = {}) => {
      const next = responses[calls.length];
      assert.ok(next, `unexpected request ${String(url)}`);
      calls.push({ init, url: String(url) });
      return next;
    },
  };
}

test("captures one exact READY production pair and cross-checks raw live runtime identity", async () => {
  const fake = fakeFetch(fixture());
  const deployments = await captureHostedDeepSeekDeploymentPair({ fetch_: fake.fetch_, token });

  assert.deepEqual(deployments, {
    api: { commit: apiCommit, deploymentId: apiDeploymentId, state: "READY" },
    web: { commit: webCommit, deploymentId: webDeploymentId, state: "READY" },
  });
  assert.equal(fake.calls.length, 7);
  assert.equal(fake.calls[5].url, "https://api.acceptance.seen-said.cn/health");
  assert.equal(fake.calls[6].url, "https://app.acceptance.seen-said.cn/analysis");
  assert.equal(
    fake.calls.every(({ init }) => init.method === "GET" && init.signal instanceof AbortSignal),
    true,
  );
  assert.equal(fake.calls[5].init.redirect, "error");
  assert.equal(fake.calls[6].init.redirect, "error");
  assert.equal(
    fake.calls.slice(0, 5).every(({ init }) => init.headers.Authorization === `Bearer ${token}`),
    true,
  );
  assert.equal(
    fake.calls.slice(5).every(({ init }) => init.headers.Authorization === undefined),
    true,
  );
});

test("rejects in-flight management state or a live runtime mismatch", async () => {
  for (const responses of [
    fixture({ apiState: "BUILDING" }),
    fixture({ runtimeApiCommit: "4".repeat(40) }),
  ]) {
    const fake = fakeFetch(responses);
    await assert.rejects(
      captureHostedDeepSeekDeploymentPair({ fetch_: fake.fetch_, token }),
      /Hosted deployment attestation failed closed\./u,
    );
  }
});

test("rejects media types that only share a valid prefix", async () => {
  for (const responses of [
    fixture({ runtimeApiContentType: "application/jsonx" }),
    fixture({ runtimeWebContentType: "text/htmlfoo" }),
  ]) {
    const fake = fakeFetch(responses);
    await assert.rejects(
      captureHostedDeepSeekDeploymentPair({ fetch_: fake.fetch_, token }),
      /Hosted deployment attestation failed closed\./u,
    );
  }
});

test("bounds every request even when the transport ignores abort", async () => {
  let timeoutCallback;
  const pending = captureHostedDeepSeekDeploymentPair({
    clearTimeout_: () => undefined,
    fetch_: async () => new Promise(() => undefined),
    setTimeout_: (callback) => {
      timeoutCallback = callback;
      return 1;
    },
    token,
  });
  await Promise.resolve();
  timeoutCallback();
  await assert.rejects(pending, /Hosted deployment attestation failed closed\./u);
});

test("never reflects response bodies, headers, tokens, or transport errors", async () => {
  const secret = "deployment-attestation-secret-canary";
  for (const fetch_ of [
    async () => response(500, secret, { "x-secret": secret }),
    async () => {
      throw new Error(secret);
    },
  ]) {
    let error;
    try {
      await captureHostedDeepSeekDeploymentPair({ fetch_, token: `${token}-${secret}` });
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.message, "Hosted deployment attestation failed closed.");
    assert.doesNotMatch(String(error), new RegExp(secret, "u"));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secret, "u"));
  }
});
