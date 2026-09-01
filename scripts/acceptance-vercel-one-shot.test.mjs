import assert from "node:assert/strict";
import { test } from "node:test";

import {
  advanceVercelOneShotState,
  expectedVercelOneShotBaselines,
  renderVercelOneShotPlan,
} from "./acceptance-vercel-one-shot.mjs";

const candidate = "1111111111111111111111111111111111111111";
const apiArm = "2222222222222222222222222222222222222222";
const apiDisarm = "3333333333333333333333333333333333333333";
const webArm = "4444444444444444444444444444444444444444";
const webDisarm = "5555555555555555555555555555555555555555";
const apiConfigIdentity = "a".repeat(64);
const webConfigIdentity = "b".repeat(64);

function deployment({ id, project, sha, state = "READY", createdAt }) {
  return { createdAt, id, project, sha, state };
}

const apiBaselineDeployment = deployment({
  createdAt: 100,
  id: "dpl_6QeRbqxgA88cFXggKekkr2axH9JM",
  project: "api",
  sha: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
});
const webBaselineDeployment = deployment({
  createdAt: 100,
  id: "dpl_V3NzjTYXtH7fb3WC2P6hpWR1twhb",
  project: "web",
  sha: "9b0860a91940e4f78968b3882af91ef5bf923b8a",
});

function history(prefix, count, latest) {
  return [
    latest,
    ...Array.from({ length: count - 1 }, (_, index) =>
      deployment({
        createdAt: 99 - index,
        id: `${prefix}${String(index).padStart(2, "0")}`,
        project: latest.project,
        sha: `${String(index + 6).repeat(40)}`.slice(0, 40),
      }),
    ),
  ];
}

const apiBaseline = history("api-base-", 16, apiBaselineDeployment);
const webBaseline = history("web-base-", 9, webBaselineDeployment);

function gitState({
  apiArmed = false,
  changedFile = null,
  commit = candidate,
  parent = null,
  webArmed = false,
} = {}) {
  return {
    apiArmed,
    apiConfigIdentity,
    branch: "codex/settings-configuration",
    changedFiles: changedFile === null ? [] : [changedFile],
    clean: true,
    commit,
    parent,
    upstreamCommit: commit,
    webArmed,
    webConfigIdentity,
  };
}

function snapshot({ api = apiBaseline, web = webBaseline } = {}) {
  return { api, web };
}

test("one-shot plan is fixed, offline, and explicit about the serial fail-closed contract", () => {
  const plan = renderVercelOneShotPlan();
  for (const expected of [
    "Hosted Vercel API/Web serial one-shot gate (read-only remote verification)",
    "API non-Canceled baseline: 16",
    "Web non-Canceled baseline: 9",
    "both projects disarmed",
    "API arm -> exactly one non-Canceled deployment -> independent API disarm",
    "Web cannot arm before API disarm is verified",
    "at most one same-push Canceled audit",
    "The fixed Vercel Keychain credential is never printed or persisted",
  ]) {
    assert.match(plan, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.deepEqual(expectedVercelOneShotBaselines, {
    api: {
      count: 16,
      latestCommit: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
      latestDeploymentId: "dpl_6QeRbqxgA88cFXggKekkr2axH9JM",
    },
    web: {
      count: 9,
      latestCommit: "9b0860a91940e4f78968b3882af91ef5bf923b8a",
      latestDeploymentId: "dpl_V3NzjTYXtH7fb3WC2P6hpWR1twhb",
    },
  });
});

test("baseline adapters must preserve the exact fixed contract shape", () => {
  for (const expectedBaselines of [
    {},
    {
      api: { ...expectedVercelOneShotBaselines.api, count: 0 },
      web: expectedVercelOneShotBaselines.web,
    },
    {
      api: expectedVercelOneShotBaselines.api,
      web: { ...expectedVercelOneShotBaselines.web, latestCommit: "wrong" },
    },
    {
      api: expectedVercelOneShotBaselines.api,
      extra: {},
      web: expectedVercelOneShotBaselines.web,
    },
  ]) {
    assert.throws(
      () =>
        advanceVercelOneShotState({
          expectedBaselines,
          git: gitState(),
          snapshot: snapshot(),
          stage: "preflight",
        }),
      /Hosted Vercel one-shot contract failed/u,
    );
  }
});

test("state machine enforces API then Web with independent disarms and no extra deployment", () => {
  const preflight = advanceVercelOneShotState({
    git: gitState(),
    snapshot: snapshot(),
    stage: "preflight",
  });
  assert.equal(preflight.phase, "preflight-passed");
  assert.equal(preflight.candidateCommit, candidate);

  const apiNew = deployment({
    createdAt: 200,
    id: "api-new",
    project: "api",
    sha: apiArm,
    state: "BUILDING",
  });
  const apiObserved = advanceVercelOneShotState({
    git: gitState({
      apiArmed: true,
      changedFile: "apps/api/vercel.json",
      commit: apiArm,
      parent: candidate,
    }),
    snapshot: snapshot({ api: [apiNew, ...apiBaseline] }),
    stage: "observe-api-arm",
    state: preflight,
  });
  assert.equal(apiObserved.phase, "api-arm-observed");

  const apiReady = { ...apiNew, state: "READY" };
  const apiClosed = advanceVercelOneShotState({
    git: gitState({
      changedFile: "apps/api/vercel.json",
      commit: apiDisarm,
      parent: apiArm,
    }),
    snapshot: snapshot({ api: [apiReady, ...apiBaseline] }),
    stage: "verify-api-disarm",
    state: apiObserved,
  });
  assert.equal(apiClosed.phase, "api-disarm-verified");

  const webNew = deployment({
    createdAt: 300,
    id: "web-new",
    project: "web",
    sha: webArm,
    state: "QUEUED",
  });
  const webObserved = advanceVercelOneShotState({
    git: gitState({
      changedFile: "apps/web/vercel.json",
      commit: webArm,
      parent: apiDisarm,
      webArmed: true,
    }),
    snapshot: snapshot({ api: [apiReady, ...apiBaseline], web: [webNew, ...webBaseline] }),
    stage: "observe-web-arm",
    state: apiClosed,
  });
  assert.equal(webObserved.phase, "web-arm-observed");

  const completed = advanceVercelOneShotState({
    git: gitState({
      changedFile: "apps/web/vercel.json",
      commit: webDisarm,
      parent: webArm,
    }),
    snapshot: snapshot({
      api: [apiReady, ...apiBaseline],
      web: [{ ...webNew, state: "READY" }, ...webBaseline],
    }),
    stage: "verify-web-disarm",
    state: webObserved,
  });
  assert.equal(completed.phase, "complete");
});

test("state machine rejects unsafe order, both armed, drift, extra, in-flight, and wrong commit", () => {
  const preflight = advanceVercelOneShotState({
    git: gitState(),
    snapshot: snapshot(),
    stage: "preflight",
  });
  const apiNew = deployment({
    createdAt: 200,
    id: "api-new",
    project: "api",
    sha: apiArm,
    state: "BUILDING",
  });
  const apiObserved = advanceVercelOneShotState({
    git: gitState({
      apiArmed: true,
      changedFile: "apps/api/vercel.json",
      commit: apiArm,
      parent: candidate,
    }),
    snapshot: snapshot({ api: [apiNew, ...apiBaseline] }),
    stage: "observe-api-arm",
    state: preflight,
  });

  for (const unsafe of [
    () =>
      advanceVercelOneShotState({
        git: gitState({ webArmed: true }),
        snapshot: snapshot(),
        stage: "observe-web-arm",
        state: preflight,
      }),
    () =>
      advanceVercelOneShotState({
        git: gitState({ apiArmed: true, webArmed: true }),
        snapshot: snapshot(),
        stage: "observe-api-arm",
        state: preflight,
      }),
    () =>
      advanceVercelOneShotState({
        git: gitState(),
        snapshot: snapshot({ api: apiBaseline.slice(0, 15) }),
        stage: "preflight",
      }),
    () =>
      advanceVercelOneShotState({
        git: gitState({
          apiArmed: true,
          changedFile: "apps/api/vercel.json",
          commit: apiArm,
          parent: candidate,
        }),
        snapshot: snapshot({ api: [apiNew, ...apiBaseline] }),
        stage: "observe-api-arm",
        state: {
          ...preflight,
          configIdentities: { ...preflight.configIdentities, api: "c".repeat(64) },
        },
      }),
    () =>
      advanceVercelOneShotState({
        git: gitState({
          changedFile: "apps/api/vercel.json",
          commit: apiDisarm,
          parent: apiArm,
        }),
        snapshot: snapshot({ api: [apiNew, ...apiBaseline] }),
        stage: "verify-api-disarm",
        state: apiObserved,
      }),
    () =>
      advanceVercelOneShotState({
        git: gitState({
          changedFile: "apps/api/vercel.json",
          commit: apiDisarm,
          parent: apiArm,
        }),
        snapshot: snapshot({
          api: [
            { ...apiNew, state: "READY" },
            deployment({
              createdAt: 201,
              id: "api-extra",
              project: "api",
              sha: apiDisarm,
            }),
            ...apiBaseline,
          ],
        }),
        stage: "verify-api-disarm",
        state: apiObserved,
      }),
    () =>
      advanceVercelOneShotState({
        git: gitState({
          changedFile: "apps/api/vercel.json",
          commit: apiDisarm,
          parent: "9999999999999999999999999999999999999999",
        }),
        snapshot: snapshot({ api: [{ ...apiNew, state: "READY" }, ...apiBaseline] }),
        stage: "verify-api-disarm",
        state: apiObserved,
      }),
  ]) {
    assert.throws(unsafe, /Hosted Vercel one-shot contract failed/u);
  }
});
