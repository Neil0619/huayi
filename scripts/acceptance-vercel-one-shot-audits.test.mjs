import assert from "node:assert/strict";
import { test } from "node:test";

import { advanceVercelOneShotState } from "./acceptance-vercel-one-shot.mjs";

const candidate = "1111111111111111111111111111111111111111";
const apiArm = "2222222222222222222222222222222222222222";
const apiDisarm = "3333333333333333333333333333333333333333";
const webArm = "4444444444444444444444444444444444444444";
const webDisarm = "5555555555555555555555555555555555555555";

function deployment({ id, project, sha, state = "READY", createdAt }) {
  return { createdAt, id, project, sha, state };
}

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

const apiBaseline = history(
  "api-base-",
  16,
  deployment({
    createdAt: 100,
    id: "dpl_6QeRbqxgA88cFXggKekkr2axH9JM",
    project: "api",
    sha: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
  }),
);
const webBaseline = history(
  "web-base-",
  9,
  deployment({
    createdAt: 100,
    id: "dpl_V3NzjTYXtH7fb3WC2P6hpWR1twhb",
    project: "web",
    sha: "9b0860a91940e4f78968b3882af91ef5bf923b8a",
  }),
);

function gitState({
  apiArmed = false,
  changedFile = null,
  commit = candidate,
  parent = null,
  webArmed = false,
} = {}) {
  return {
    apiArmed,
    apiConfigIdentity: "a".repeat(64),
    branch: "codex/settings-configuration",
    changedFiles: changedFile === null ? [] : [changedFile],
    clean: true,
    commit,
    parent,
    upstreamCommit: commit,
    webArmed,
    webConfigIdentity: "b".repeat(64),
  };
}

function snapshot({ api = apiBaseline, web = webBaseline } = {}) {
  return { api, web };
}

test("state machine freezes at most one exact-source Canceled audit per disarmed project and push", () => {
  const preflight = advanceVercelOneShotState({
    git: gitState(),
    snapshot: snapshot(),
    stage: "preflight",
  });
  const apiNew = deployment({
    createdAt: 200,
    id: "api-new-with-audits",
    project: "api",
    sha: apiArm,
    state: "BUILDING",
  });
  const webApiArmAudit = deployment({
    createdAt: 201,
    id: "web-api-arm-canceled",
    project: "web",
    sha: apiArm,
    state: "CANCELED",
  });
  const apiObserved = advanceVercelOneShotState({
    git: gitState({
      apiArmed: true,
      changedFile: "apps/api/vercel.json",
      commit: apiArm,
      parent: candidate,
    }),
    snapshot: snapshot({ api: [apiNew, ...apiBaseline], web: [webApiArmAudit, ...webBaseline] }),
    stage: "observe-api-arm",
    state: preflight,
  });
  assert.deepEqual(apiObserved.audits, { api: [], web: [webApiArmAudit] });

  const apiReady = { ...apiNew, state: "READY" };
  const apiDisarmAudit = deployment({
    createdAt: 211,
    id: "api-api-disarm-canceled",
    project: "api",
    sha: apiDisarm,
    state: "CANCELED",
  });
  const webApiDisarmAudit = deployment({
    createdAt: 212,
    id: "web-api-disarm-canceled",
    project: "web",
    sha: apiDisarm,
    state: "CANCELED",
  });
  const apiClosed = advanceVercelOneShotState({
    git: gitState({
      changedFile: "apps/api/vercel.json",
      commit: apiDisarm,
      parent: apiArm,
    }),
    snapshot: snapshot({
      api: [apiDisarmAudit, apiReady, ...apiBaseline],
      web: [webApiDisarmAudit, webApiArmAudit, ...webBaseline],
    }),
    stage: "verify-api-disarm",
    state: apiObserved,
  });
  assert.deepEqual(apiClosed.audits, {
    api: [apiDisarmAudit],
    web: [webApiDisarmAudit, webApiArmAudit],
  });

  const apiWebArmAudit = deployment({
    createdAt: 301,
    id: "api-web-arm-canceled",
    project: "api",
    sha: webArm,
    state: "CANCELED",
  });
  const webNew = deployment({
    createdAt: 302,
    id: "web-new-with-audits",
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
    snapshot: snapshot({
      api: [apiWebArmAudit, apiDisarmAudit, apiReady, ...apiBaseline],
      web: [webNew, webApiDisarmAudit, webApiArmAudit, ...webBaseline],
    }),
    stage: "observe-web-arm",
    state: apiClosed,
  });
  assert.deepEqual(webObserved.audits.api, [apiWebArmAudit, apiDisarmAudit]);

  const apiWebDisarmAudit = deployment({
    createdAt: 401,
    id: "api-web-disarm-canceled",
    project: "api",
    sha: webDisarm,
    state: "CANCELED",
  });
  const webWebDisarmAudit = deployment({
    createdAt: 402,
    id: "web-web-disarm-canceled",
    project: "web",
    sha: webDisarm,
    state: "CANCELED",
  });
  const completed = advanceVercelOneShotState({
    git: gitState({
      changedFile: "apps/web/vercel.json",
      commit: webDisarm,
      parent: webArm,
    }),
    snapshot: snapshot({
      api: [apiWebDisarmAudit, apiWebArmAudit, apiDisarmAudit, apiReady, ...apiBaseline],
      web: [
        webWebDisarmAudit,
        { ...webNew, state: "READY" },
        webApiDisarmAudit,
        webApiArmAudit,
        ...webBaseline,
      ],
    }),
    stage: "verify-web-disarm",
    state: webObserved,
  });
  assert.equal(completed.phase, "complete");
  assert.deepEqual(completed.audits.api, [apiWebDisarmAudit, apiWebArmAudit, apiDisarmAudit]);
  assert.deepEqual(completed.audits.web, [webWebDisarmAudit, webApiDisarmAudit, webApiArmAudit]);
});

test("Canceled audit allowances reject wrong source, duplicates, non-Canceled rows, and mutation", () => {
  const preflight = advanceVercelOneShotState({
    git: gitState(),
    snapshot: snapshot(),
    stage: "preflight",
  });
  const apiNew = deployment({
    createdAt: 200,
    id: "api-audit-negative-new",
    project: "api",
    sha: apiArm,
    state: "BUILDING",
  });
  const validAudit = deployment({
    createdAt: 201,
    id: "web-audit-negative-valid",
    project: "web",
    sha: apiArm,
    state: "CANCELED",
  });
  for (const web of [
    [{ ...validAudit, sha: "9".repeat(40) }, ...webBaseline],
    [validAudit, { ...validAudit, createdAt: 202, id: "web-audit-duplicate" }, ...webBaseline],
    [{ ...validAudit, state: "BUILDING" }, ...webBaseline],
    [{ ...validAudit, state: "ERROR" }, ...webBaseline],
    [{ ...validAudit, state: "READY" }, ...webBaseline],
  ]) {
    assert.throws(
      () =>
        advanceVercelOneShotState({
          git: gitState({
            apiArmed: true,
            changedFile: "apps/api/vercel.json",
            commit: apiArm,
            parent: candidate,
          }),
          snapshot: snapshot({ api: [apiNew, ...apiBaseline], web }),
          stage: "observe-api-arm",
          state: preflight,
        }),
      /Hosted Vercel one-shot contract failed/u,
    );
  }

  const observed = advanceVercelOneShotState({
    git: gitState({
      apiArmed: true,
      changedFile: "apps/api/vercel.json",
      commit: apiArm,
      parent: candidate,
    }),
    snapshot: snapshot({ api: [apiNew, ...apiBaseline], web: [validAudit, ...webBaseline] }),
    stage: "observe-api-arm",
    state: preflight,
  });
  assert.throws(
    () =>
      advanceVercelOneShotState({
        git: gitState({
          changedFile: "apps/api/vercel.json",
          commit: apiDisarm,
          parent: apiArm,
        }),
        snapshot: snapshot({
          api: [{ ...apiNew, state: "READY" }, ...apiBaseline],
          web: [{ ...validAudit, state: "ERROR" }, ...webBaseline],
        }),
        stage: "verify-api-disarm",
        state: observed,
      }),
    /Hosted Vercel one-shot contract failed/u,
  );
});
