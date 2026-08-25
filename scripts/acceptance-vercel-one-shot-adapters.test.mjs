import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inspectVercelOneShotGit,
  readVercelOneShotSnapshot,
  runVercelOneShotCli,
  vercelOneShotConfirmation,
} from "./acceptance-vercel-one-shot.mjs";

const token = "vercel-one-shot-test-token";
const teamId = "team_seen_said_acceptance";
const candidate = "1111111111111111111111111111111111111111";
const remoteSecret = "remote-secret-must-not-be-reflected";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
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

function rawHistory({ count, latestId, latestSha, projectId, projectName }) {
  return [
    rawDeployment({
      createdAt: 1_000,
      id: latestId,
      projectId,
      projectName,
      sha: latestSha,
    }),
    ...Array.from({ length: count - 1 }, (_, index) =>
      rawDeployment({
        createdAt: 999 - index,
        id: `${projectName}-${index}`,
        projectId,
        projectName,
        sha: `${((index + 6) % 10).toString().repeat(40)}`,
      }),
    ),
  ];
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

function fakeFetch(expectations) {
  const calls = [];
  return {
    calls,
    fetch_: async (url, init = {}) => {
      const expected = expectations[calls.length];
      assert.ok(expected, `unexpected request ${String(url)}`);
      calls.push({ init, url: String(url) });
      assert.equal(String(url), expected.url);
      assert.equal(init.method, "GET");
      assert.deepEqual(init.headers, {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      });
      return jsonResponse(expected.status ?? 200, expected.body);
    },
    done() {
      assert.equal(calls.length, expectations.length);
    },
  };
}

function remoteFixture({ apiHistory, webHistory } = {}) {
  const apiProjectId = "prj_seen_said_acceptance_api";
  const webProjectId = "prj_seen_said_acceptance_web";
  const api =
    apiHistory ??
    rawHistory({
      count: 16,
      latestId: "6QeRbqxgA88cFXggKekkr2axH9JM",
      latestSha: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
      projectId: apiProjectId,
      projectName: "seen-said-acceptance-api",
    });
  const web =
    webHistory ??
    rawHistory({
      count: 9,
      latestId: "V3NzjTYXtH7fb3WC2P6hpWR1twhb",
      latestSha: "9b0860a91940e4f78968b3882af91ef5bf923b8a",
      projectId: webProjectId,
      projectName: "seen-said-acceptance-web",
    });
  return [
    {
      body: {
        pagination: { count: 1, next: null, prev: null },
        teams: [{ id: teamId, name: "neil0619's projects", slug: "neil0619s-projects" }],
      },
      url: "https://api.vercel.com/v2/teams?limit=100",
    },
    {
      body: project({
        framework: "hono",
        id: apiProjectId,
        name: "seen-said-acceptance-api",
        rootDirectory: "apps/api",
      }),
      url: `https://api.vercel.com/v9/projects/seen-said-acceptance-api?teamId=${teamId}`,
    },
    {
      body: { deployments: api, pagination: { count: api.length, next: null, prev: null } },
      url: `https://api.vercel.com/v7/deployments?projectId=${apiProjectId}&limit=100&teamId=${teamId}`,
    },
    {
      body: project({
        framework: "vite",
        id: webProjectId,
        name: "seen-said-acceptance-web",
        rootDirectory: "apps/web",
      }),
      url: `https://api.vercel.com/v9/projects/seen-said-acceptance-web?teamId=${teamId}`,
    },
    {
      body: { deployments: web, pagination: { count: web.length, next: null, prev: null } },
      url: `https://api.vercel.com/v7/deployments?projectId=${webProjectId}&limit=100&teamId=${teamId}`,
    },
  ];
}

test("Git inspection uses a bounded process contract and recognizes one exact armed project", async () => {
  const repositoryRoot = "/repo";
  const outputs = new Map([
    ["status --porcelain=v1 --untracked-files=normal", ""],
    ["rev-parse --show-toplevel", `${repositoryRoot}\n`],
    ["symbolic-ref --quiet --short HEAD", "codex/settings-configuration\n"],
    ["rev-parse HEAD", `${candidate}\n`],
    ["rev-parse @{upstream}", `${candidate}\n`],
    ["rev-parse HEAD^", `${"2".repeat(40)}\n`],
    ["diff-tree --no-commit-id --name-only -r HEAD", "apps/api/vercel.json\n"],
  ]);
  const calls = [];
  const result = await inspectVercelOneShotGit({
    readFile: async (path) => {
      if (path.endsWith("apps/api/vercel.json")) {
        return JSON.stringify({
          git: {
            deploymentEnabled: {
              "**": false,
              "codex/settings-configuration": true,
            },
          },
        });
      }
      return JSON.stringify({ git: { deploymentEnabled: false } });
    },
    repositoryRoot,
    runProcess: async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      const stdout = outputs.get(arguments_.join(" "));
      assert.notEqual(stdout, undefined);
      return { status: 0, stderr: "", stdout };
    },
  });
  assert.deepEqual(result, {
    apiArmed: true,
    apiConfigIdentity: result.apiConfigIdentity,
    branch: "codex/settings-configuration",
    changedFiles: ["apps/api/vercel.json"],
    clean: true,
    commit: candidate,
    parent: "2".repeat(40),
    upstreamCommit: candidate,
    webArmed: false,
    webConfigIdentity: result.webConfigIdentity,
  });
  assert.match(result.apiConfigIdentity, /^[0-9a-f]{64}$/u);
  assert.match(result.webConfigIdentity, /^[0-9a-f]{64}$/u);
  assert.equal(
    calls.every((call) => call.command === "git"),
    true,
  );
  assert.equal(
    calls.every((call) => call.options.cwd === repositoryRoot),
    true,
  );
});

test("remote snapshot is read-only, exact-project scoped, and preserves Canceled audit history", async () => {
  const expectations = remoteFixture();
  const apiResponse = expectations[2].body;
  apiResponse.deployments.push(
    rawDeployment({
      createdAt: 500,
      id: "api-canceled-audit",
      projectId: "prj_seen_said_acceptance_api",
      projectName: "seen-said-acceptance-api",
      sha: "c".repeat(40),
      state: "CANCELED",
    }),
  );
  apiResponse.pagination.count += 1;
  const fake = fakeFetch(expectations);
  const result = await readVercelOneShotSnapshot({ fetch_: fake.fetch_, token });
  assert.equal(result.api.length, 17);
  assert.equal(result.web.length, 9);
  assert.deepEqual(result.api[0], {
    createdAt: 1_000,
    id: "6QeRbqxgA88cFXggKekkr2axH9JM",
    project: "api",
    sha: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
    state: "READY",
  });
  assert.equal(
    fake.calls.every((call) => call.init.body === undefined),
    true,
  );
  fake.done();
});

test("remote ambiguity, pagination, wrong project, unsafe state, or response secret fails closed", async () => {
  for (const expectations of [
    remoteFixture().map((entry, index) =>
      index === 0
        ? { ...entry, body: { ...entry.body, pagination: { count: 1, next: 123, prev: null } } }
        : entry,
    ),
    remoteFixture().map((entry, index) =>
      index === 2
        ? { ...entry, body: { ...entry.body, pagination: { count: 16, next: 123, prev: null } } }
        : entry,
    ),
    remoteFixture().map((entry, index) =>
      index === 1 ? { ...entry, body: { ...entry.body, name: "wrong" } } : entry,
    ),
    remoteFixture().map((entry, index) =>
      index === 2
        ? {
            ...entry,
            body: {
              deployments: [{ ...entry.body.deployments[0], readyState: "UNKNOWN" }],
              pagination: { count: 1, next: null, prev: null },
            },
          }
        : entry,
    ),
    [
      {
        body: { error: { message: remoteSecret }, token },
        status: 500,
        url: "https://api.vercel.com/v2/teams?limit=100",
      },
    ],
  ]) {
    const fake = fakeFetch(expectations);
    await assert.rejects(
      readVercelOneShotSnapshot({ fetch_: fake.fetch_, token }),
      /Hosted Vercel one-shot remote verification failed/u,
    );
  }
});

test("CLI preflight wires exact Git and remote evidence into token-free private state", async () => {
  const fake = fakeFetch(remoteFixture());
  let state;
  let stdout = "";
  const code = await runVercelOneShotCli({
    arguments_: ["preflight", vercelOneShotConfirmation],
    environment: { VERCEL_TOKEN: token },
    fetch_: fake.fetch_,
    inspectGit_: async () => ({
      apiArmed: false,
      apiConfigIdentity: "a".repeat(64),
      branch: "codex/settings-configuration",
      changedFiles: [],
      clean: true,
      commit: candidate,
      parent: "2".repeat(40),
      upstreamCommit: candidate,
      webArmed: false,
      webConfigIdentity: "b".repeat(64),
    }),
    stateStore: {
      read: async () => undefined,
      write: async (value) => {
        state = value;
      },
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(stdout, "Hosted Vercel one-shot gate passed: preflight.\n");
  assert.equal(state.phase, "preflight-passed");
  assert.equal(state.candidateCommit, candidate);
  assert.doesNotMatch(JSON.stringify(state), new RegExp(token, "u"));
  fake.done();
});
