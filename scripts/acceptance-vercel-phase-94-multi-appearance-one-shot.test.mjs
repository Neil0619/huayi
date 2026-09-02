import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  phase94MultiAppearanceVercelOneShotBaselines,
  phase94MultiAppearanceVercelOneShotConfirmation,
  renderPhase94MultiAppearanceVercelOneShotPlan,
  runPhase94MultiAppearanceVercelOneShotCli,
} from "./acceptance-vercel-phase-94-multi-appearance-one-shot.mjs";
import { phase94MultiAppearanceVercelDiagnosticArgument } from "./acceptance-vercel-phase-94-multi-appearance-one-shot-diagnostic.mjs";
import { validatePhase93FreshCsrfVercelCompletion } from "./acceptance-vercel-phase-93-fresh-csrf-completion.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";
import {
  apiArmCommit,
  apiDisarmCommit,
  candidate,
  deployment,
  gitState,
  phase93FreshCompleteState,
  phase94BaselineSnapshot,
  token,
  webArmCommit,
  webDisarmCommit,
} from "./acceptance-vercel-phase-94-multi-appearance-test-support.mjs";

test("package exposes the independent Phase 94 multi-appearance serial deployment surface", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entries = Object.entries(packageDocument.scripts)
    .filter(([name]) => name.startsWith("acceptance:hosted:phase94:deployment:one-shot:"))
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(entries, [
    [
      "acceptance:hosted:phase94:deployment:one-shot:api:arm:observe",
      `node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot.mjs observe-api-arm ${phase94MultiAppearanceVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase94:deployment:one-shot:api:disarm:verify",
      `node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot.mjs verify-api-disarm ${phase94MultiAppearanceVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase94:deployment:one-shot:diagnose",
      `node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot-diagnostic.mjs ${phase94MultiAppearanceVercelDiagnosticArgument}`,
    ],
    [
      "acceptance:hosted:phase94:deployment:one-shot:plan",
      "node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot.mjs plan",
    ],
    [
      "acceptance:hosted:phase94:deployment:one-shot:preflight",
      `node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot.mjs preflight ${phase94MultiAppearanceVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase94:deployment:one-shot:web:arm:observe",
      `node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot.mjs observe-web-arm ${phase94MultiAppearanceVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase94:deployment:one-shot:web:disarm:verify",
      `node scripts/acceptance-vercel-phase-94-multi-appearance-one-shot.mjs verify-web-disarm ${phase94MultiAppearanceVercelOneShotConfirmation}`,
    ],
  ]);
});

test("Phase 94 plan is zero-I/O and pins the independent 20/13 baseline", async () => {
  assert.deepEqual(phase94MultiAppearanceVercelOneShotBaselines, {
    api: {
      count: 20,
      latestCommit: phase93FreshCompleteState().apiArmCommit,
      latestDeploymentId: "dpl_9yRrWmWs4zhuJcALX92wM3LLr8mu",
    },
    web: {
      count: 13,
      latestCommit: phase93FreshCompleteState().webArmCommit,
      latestDeploymentId: "dpl_Bqaj9sapoJd4wnwxq24eMorJdPMd",
    },
  });
  let touched = false;
  let stdout = "";
  const code = await runPhase94MultiAppearanceVercelOneShotCli({
    arguments_: ["plan"],
    historicalStateStore: { read: async () => (touched = true) },
    inspectGit_: async () => (touched = true),
    readSnapshot_: async () => (touched = true),
    stateStore: { read: async () => (touched = true), write: async () => (touched = true) },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 0);
  assert.equal(touched, false);
  assert.equal(stdout, renderPhase94MultiAppearanceVercelOneShotPlan());
  assert.match(stdout, /phase-94-multi-appearance-ui-state\.json/u);
  assert.match(stdout, /20 API \/ 13 Web/u);
  assert.match(stdout, /phase-93-0023-fresh-csrf-state\.json remains immutable/u);
});

test("Phase 94 preflight requires the exact fresh-CSRF completion and current baseline", async () => {
  validatePhase93FreshCsrfVercelCompletion(phase93FreshCompleteState());
  assert.throws(
    () =>
      validatePhase93FreshCsrfVercelCompletion({
        ...phase93FreshCompleteState(),
        webDisarmCommit: "f".repeat(40),
      }),
    /completion verification failed/u,
  );
  let state;
  const code = await runPhase94MultiAppearanceVercelOneShotCli({
    arguments_: ["preflight", phase94MultiAppearanceVercelOneShotConfirmation],
    environment: {},
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async (credentialId) => {
      assert.equal(credentialId, "vercel-token");
      return token;
    },
    readSnapshot_: async () => phase94BaselineSnapshot(),
    stateStore: { read: async () => state, write: async (value) => (state = value) },
  });
  assert.equal(code, 0);
  assert.equal(state.phase, "preflight-passed");
  assert.equal(state.candidateCommit, candidate);
});

test("Phase 94 preflight rejects a matching baseline whose latest deployment is not Ready", async () => {
  let state;
  const snapshot = phase94BaselineSnapshot();
  snapshot.api[0] = { ...snapshot.api[0], state: "ERROR" };
  const code = await runPhase94MultiAppearanceVercelOneShotCli({
    arguments_: ["preflight", phase94MultiAppearanceVercelOneShotConfirmation],
    environment: {},
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async () => token,
    readSnapshot_: async () => snapshot,
    stateStore: { read: async () => state, write: async (value) => (state = value) },
  });
  assert.equal(code, 1);
  assert.equal(state, undefined);
});

test("every Phase 94 transition validates historical completion before Git, credentials, or Vercel", async () => {
  for (const stage of [
    "preflight",
    "observe-api-arm",
    "verify-api-disarm",
    "observe-web-arm",
    "verify-web-disarm",
  ]) {
    let touched = false;
    const code = await runPhase94MultiAppearanceVercelOneShotCli({
      arguments_: [stage, phase94MultiAppearanceVercelOneShotConfirmation],
      historicalStateStore: {
        read: async () => ({
          ...phase93FreshCompleteState(),
          apiDeployment: { ...phase93FreshCompleteState().apiDeployment, state: "ERROR" },
        }),
      },
      inspectGit_: async () => (touched = true),
      readCredential: async () => (touched = true),
      readSnapshot_: async () => (touched = true),
      stateStore: { read: async () => (touched = true), write: async () => (touched = true) },
    });
    assert.equal(code, 1, stage);
    assert.equal(touched, false, stage);
  }
});

test("Phase 94 reuses the complete API then Web serial transition machine", async () => {
  let state;
  const run = async (stage, git, snapshot) =>
    runPhase94MultiAppearanceVercelOneShotCli({
      arguments_: [stage, phase94MultiAppearanceVercelOneShotConfirmation],
      environment: {},
      historicalStateStore: { read: async () => phase93FreshCompleteState() },
      inspectGit_: async () => git,
      readCredential: async () => token,
      readSnapshot_: async () => snapshot,
      stateStore: { read: async () => state, write: async (value) => (state = value) },
    });
  const baseline = phase94BaselineSnapshot();
  assert.equal(await run("preflight", gitState(), baseline), 0);
  const apiTarget = deployment({
    createdAt: 2_000_000_000_000,
    id: "dpl_phase94_api_target",
    project: "api",
    sha: apiArmCommit,
    state: "BUILDING",
  });
  assert.equal(
    await run(
      "observe-api-arm",
      gitState({
        apiArmed: true,
        changedFiles: ["apps/api/vercel.json"],
        commit: apiArmCommit,
        parent: candidate,
      }),
      { api: [apiTarget, ...baseline.api], web: baseline.web },
    ),
    0,
  );
  assert.equal(state.phase, "api-arm-observed");
  const readyApiTarget = { ...apiTarget, state: "READY" };
  assert.equal(
    await run(
      "verify-api-disarm",
      gitState({
        changedFiles: ["apps/api/vercel.json"],
        commit: apiDisarmCommit,
        parent: apiArmCommit,
      }),
      { api: [readyApiTarget, ...baseline.api], web: baseline.web },
    ),
    0,
  );
  assert.equal(state.phase, "api-disarm-verified");
  const webTarget = deployment({
    createdAt: 2_000_000_000_100,
    id: "dpl_phase94_web_target",
    project: "web",
    sha: webArmCommit,
    state: "BUILDING",
  });
  assert.equal(
    await run(
      "observe-web-arm",
      gitState({
        changedFiles: ["apps/web/vercel.json"],
        commit: webArmCommit,
        parent: apiDisarmCommit,
        webArmed: true,
      }),
      { api: [readyApiTarget, ...baseline.api], web: [webTarget, ...baseline.web] },
    ),
    0,
  );
  assert.equal(state.phase, "web-arm-observed");
  assert.equal(
    await run(
      "verify-web-disarm",
      gitState({
        changedFiles: ["apps/web/vercel.json"],
        commit: webDisarmCommit,
        parent: webArmCommit,
      }),
      {
        api: [readyApiTarget, ...baseline.api],
        web: [{ ...webTarget, state: "READY" }, ...baseline.web],
      },
    ),
    0,
  );
  assert.equal(state.phase, "complete");
});

test("Phase 94 rejects any older confirmation before I/O", async () => {
  let touched = false;
  let stderr = "";
  const code = await runPhase94MultiAppearanceVercelOneShotCli({
    arguments_: [
      "preflight",
      "--confirm-hosted-vercel-phase-93-0023-fresh-csrf-serial-one-shot-neil0619s-projects",
    ],
    historicalStateStore: { read: async () => (touched = true) },
    inspectGit_: async () => (touched = true),
    readSnapshot_: async () => (touched = true),
    stateStore: { read: async () => (touched = true), write: async () => (touched = true) },
    writeError: (value) => (stderr += value),
  });
  assert.equal(code, 1);
  assert.equal(touched, false);
  assert.equal(stderr, "Hosted Phase 94 multi-appearance Vercel one-shot gate failed.\n");
});

test("Phase 94 transition rejects legacy plaintext token before credential, remote, or state write", async () => {
  let credentialReads = 0;
  let remoteReads = 0;
  let writes = 0;
  let stderr = "";
  const code = await runPhase94MultiAppearanceVercelOneShotCli({
    arguments_: ["preflight", phase94MultiAppearanceVercelOneShotConfirmation],
    environment: { VERCEL_TOKEN: token },
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async () => (credentialReads += 1),
    readSnapshot_: async () => (remoteReads += 1),
    stateStore: { read: async () => undefined, write: async () => (writes += 1) },
    writeError: (value) => (stderr += value),
  });
  assert.equal(code, 1);
  assert.equal(credentialReads, 0);
  assert.equal(remoteReads, 0);
  assert.equal(writes, 0);
  assert.equal(stderr, "Hosted Phase 94 multi-appearance Vercel one-shot gate failed.\n");
  assert.doesNotMatch(stderr, new RegExp(token, "u"));
});

test("all historical and Phase 94 state files coexist without overwrite", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-phase-94-"));
  const platformOptions =
    process.platform === "win32"
      ? { directorySync: async () => undefined, privateModeMatches: () => true }
      : {};
  try {
    const identities = [
      undefined,
      "phase-92-0022",
      "phase-93-0023",
      "phase-93-0023-fresh-csrf",
      "phase-94-multi-appearance-ui",
    ];
    const stores = identities.map((stateIdentity) =>
      createVercelOneShotStateStore({
        ...platformOptions,
        repositoryRoot,
        ...(stateIdentity === undefined ? {} : { stateIdentity }),
      }),
    );
    for (let index = 0; index < stores.length; index += 1) {
      await stores[index].write({ contract: `state-${index}` });
    }
    assert.deepEqual(
      (await readdir(join(repositoryRoot, "artifacts", "hosted-vercel-one-shot"))).sort(),
      [
        "phase-81-0014-state.json",
        "phase-92-0022-state.json",
        "phase-93-0023-fresh-csrf-state.json",
        "phase-93-0023-state.json",
        "phase-94-multi-appearance-ui-state.json",
      ],
    );
    assert.deepEqual(await stores[3].read(), { contract: "state-3" });
    assert.deepEqual(await stores[4].read(), { contract: "state-4" });
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
