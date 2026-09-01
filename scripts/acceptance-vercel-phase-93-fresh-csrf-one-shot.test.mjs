import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  phase93FreshCsrfVercelOneShotBaselines,
  phase93FreshCsrfVercelOneShotConfirmation,
  renderPhase93FreshCsrfVercelOneShotPlan,
  runPhase93FreshCsrfVercelOneShotCli,
} from "./acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs";
import {
  phase93FreshCsrfVercelDiagnosticArgument,
  phase93FreshCsrfVercelDiagnosticFieldNames,
  runPhase93FreshCsrfVercelDiagnosticCli,
} from "./acceptance-vercel-phase-93-fresh-csrf-one-shot-diagnostic.mjs";
import { validatePhase93VercelCompletion } from "./acceptance-vercel-phase-93-completion.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

const candidate = "882d3d41a9c48502ca795f80fd71e1e0211e63dc";
const token = "vercel-phase-93-fresh-csrf-test-token";
const apiArmCommit = "959878a44ed12cb25f4886dac97cc35501f12571";
const apiDisarmCommit = "d08646d01921e40b08b1780e0373ec188e8684c5";
const webArmCommit = "339e419130f80190c582e7afb7a3fa3b4acbb3a8";
const webDisarmCommit = "8a3f9b9a2204b8e884b0d7da589d96bb7f73dcf3";

function deployment({ createdAt, id, project, sha, state = "READY" }) {
  return { createdAt, id, project, sha, state };
}

function history(project, count, latest, prefix) {
  return [
    latest,
    ...Array.from({ length: count - 1 }, (_, index) =>
      deployment({
        createdAt: 99 - index,
        id: `${project}-${prefix}-${index}`,
        project,
        sha: `${String(index + 1).padStart(2, "0")}`.repeat(20),
      }),
    ),
  ];
}

function phase93BaselineSnapshot() {
  return {
    api: history(
      "api",
      18,
      deployment({
        createdAt: 100,
        id: "dpl_H4mWYY3dWd42VVw7FWidTcc3Cwu5",
        project: "api",
        sha: "ca6f5bdf9f356b7f6a0f5c56b6e9af52e225b1a8",
      }),
      "phase93-baseline",
    ),
    web: history(
      "web",
      11,
      deployment({
        createdAt: 100,
        id: "dpl_FQopGTKEn7QJLVTTLo86bGJfuWx1",
        project: "web",
        sha: "b044dda6b9a4626aa54d962acceb23efb1c4520a",
      }),
      "phase93-baseline",
    ),
  };
}

function phase93CompleteState() {
  return {
    apiArmCommit,
    apiDeployment: deployment({
      createdAt: 1_788_255_123_987,
      id: "dpl_9miGwwDqjGH68n5ysjjHRQQwMSSW",
      project: "api",
      sha: apiArmCommit,
    }),
    apiDisarmCommit,
    audits: { api: [], web: [] },
    baseline: phase93BaselineSnapshot(),
    candidateCommit: "526ac493d094b0ed8bd5f2112c5577b9a2f949dd",
    configIdentities: {
      api: "cc2b06ad9bbba07848cf0ecb68e0683282c2e41df7e83f50638f7fcb83d43d99",
      web: "d8c08a0ba11c3005549a03eced3f62195b2609401d9f3fe7531079898b514bb4",
    },
    contract: "huayi-hosted-vercel-serial-one-shot/v1",
    phase: "complete",
    webArmCommit,
    webDeployment: deployment({
      createdAt: 1_788_255_734_281,
      id: "dpl_7fHbE9VxXL73CJ93RSpYnxAhvDS6",
      project: "web",
      sha: webArmCommit,
    }),
    webDisarmCommit,
  };
}

function freshBaselineSnapshot() {
  return {
    api: history("api", 19, phase93CompleteState().apiDeployment, "fresh-csrf-baseline"),
    web: history("web", 12, phase93CompleteState().webDeployment, "fresh-csrf-baseline"),
  };
}

function gitState() {
  return {
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
  };
}

async function tracedFreshSnapshot({ fetch_ }) {
  for (let index = 0; index < 5; index += 1) await fetch_();
  return freshBaselineSnapshot();
}

test("package exposes an independent Phase 93 fresh-CSRF redeployment surface", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entries = Object.entries(packageDocument.scripts)
    .filter(([name]) =>
      name.startsWith("acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:"),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(entries, [
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:api:arm:observe",
      `node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs observe-api-arm ${phase93FreshCsrfVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:api:disarm:verify",
      `node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs verify-api-disarm ${phase93FreshCsrfVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:diagnose",
      `node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot-diagnostic.mjs ${phase93FreshCsrfVercelDiagnosticArgument}`,
    ],
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:plan",
      "node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs plan",
    ],
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:preflight",
      `node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs preflight ${phase93FreshCsrfVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:web:arm:observe",
      `node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs observe-web-arm ${phase93FreshCsrfVercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:web:disarm:verify",
      `node scripts/acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs verify-web-disarm ${phase93FreshCsrfVercelOneShotConfirmation}`,
    ],
  ]);
});

test("fresh-CSRF plan is zero-I/O and pins the independent 19/12 baseline", async () => {
  assert.deepEqual(phase93FreshCsrfVercelOneShotBaselines, {
    api: {
      count: 19,
      latestCommit: apiArmCommit,
      latestDeploymentId: "dpl_9miGwwDqjGH68n5ysjjHRQQwMSSW",
    },
    web: {
      count: 12,
      latestCommit: webArmCommit,
      latestDeploymentId: "dpl_7fHbE9VxXL73CJ93RSpYnxAhvDS6",
    },
  });
  let touched = false;
  let stdout = "";
  const code = await runPhase93FreshCsrfVercelOneShotCli({
    arguments_: ["plan"],
    historicalStateStore: { read: async () => (touched = true) },
    inspectGit_: async () => (touched = true),
    readSnapshot_: async () => (touched = true),
    stateStore: { read: async () => (touched = true), write: async () => (touched = true) },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 0);
  assert.equal(touched, false);
  assert.equal(stdout, renderPhase93FreshCsrfVercelOneShotPlan());
  assert.match(stdout, /phase-93-0023-fresh-csrf-state\.json/u);
  assert.match(stdout, /19 API \/ 12 Web/u);
  assert.match(stdout, /phase-93-0023-state\.json remains immutable/u);
});

test("fresh-CSRF preflight requires exact historical completion and current baseline", async () => {
  validatePhase93VercelCompletion(phase93CompleteState());
  assert.throws(
    () =>
      validatePhase93VercelCompletion({
        ...phase93CompleteState(),
        webDisarmCommit: "f".repeat(40),
      }),
    /completion verification failed/u,
  );
  let state;
  const code = await runPhase93FreshCsrfVercelOneShotCli({
    arguments_: ["preflight", phase93FreshCsrfVercelOneShotConfirmation],
    environment: {},
    historicalStateStore: { read: async () => phase93CompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async (credentialId) => {
      assert.equal(credentialId, "vercel-token");
      return token;
    },
    readSnapshot_: async () => freshBaselineSnapshot(),
    stateStore: { read: async () => state, write: async (value) => (state = value) },
  });
  assert.equal(code, 0);
  assert.equal(state.phase, "preflight-passed");
  assert.equal(state.candidateCommit, candidate);

  let touchedRemote = false;
  assert.equal(
    await runPhase93FreshCsrfVercelOneShotCli({
      arguments_: ["preflight", phase93FreshCsrfVercelOneShotConfirmation],
      historicalStateStore: { read: async () => undefined },
      inspectGit_: async () => (touchedRemote = true),
      readSnapshot_: async () => (touchedRemote = true),
      stateStore: { read: async () => undefined, write: async () => (touchedRemote = true) },
    }),
    1,
  );
  assert.equal(touchedRemote, false);
});

test("fresh-CSRF diagnostic is read-only, sanitized, and proves both generations", async () => {
  let writes = 0;
  let stdout = "";
  const code = await runPhase93FreshCsrfVercelDiagnosticCli({
    arguments_: [phase93FreshCsrfVercelDiagnosticArgument],
    environment: {},
    fetch_: async () => ({ status: 200 }),
    historicalStateStore: { read: async () => phase93CompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async (credentialId) => {
      assert.equal(credentialId, "vercel-token");
      return token;
    },
    readSnapshot_: tracedFreshSnapshot,
    stateStore: { read: async () => undefined, write: async () => (writes += 1) },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 0);
  assert.equal(writes, 0);
  assert.deepEqual(
    stdout
      .trimEnd()
      .split("\n")
      .map((line) => line.split("|")[0]),
    phase93FreshCsrfVercelDiagnosticFieldNames,
  );
  const lines = new Set(stdout.trimEnd().split("\n"));
  for (const line of [
    "historical_state_readable|t",
    "historical_state_complete|t",
    "state_absent|t",
    "git_contract_exact|t",
    "request_count|5",
    "api_non_canceled_count|19",
    "web_non_canceled_count|12",
    "candidate_baseline_exact|t",
    "contract_exact|t",
    "state_write_attempted|f",
  ]) {
    assert.equal(lines.has(line), true, `missing diagnostic line: ${line}`);
  }
  assert.doesNotMatch(stdout, new RegExp(`${token}|dpl_|${candidate}`, "u"));
});

test("fresh-CSRF diagnostic fails a drifted historical completion closed", async () => {
  let stdout = "";
  const drifted = { ...phase93CompleteState(), apiDisarmCommit: "f".repeat(40) };
  const code = await runPhase93FreshCsrfVercelDiagnosticCli({
    arguments_: [phase93FreshCsrfVercelDiagnosticArgument],
    environment: {},
    fetch_: async () => ({ status: 200 }),
    historicalStateStore: { read: async () => drifted },
    inspectGit_: async () => gitState(),
    readCredential: async () => token,
    readSnapshot_: tracedFreshSnapshot,
    stateStore: { read: async () => undefined },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 1);
  assert.match(stdout, /^historical_state_readable\|t$/mu);
  assert.match(stdout, /^historical_state_complete\|f$/mu);
  assert.match(stdout, /^candidate_baseline_exact\|t$/mu);
  assert.match(stdout, /^contract_exact\|f$/mu);
  assert.doesNotMatch(stdout, new RegExp(`${token}|${drifted.apiDisarmCommit}`, "u"));
});

test("fresh-CSRF diagnostic rejects legacy token environment before credential or remote work", async () => {
  let credentialReads = 0;
  let remoteReads = 0;
  let stdout = "";
  const code = await runPhase93FreshCsrfVercelDiagnosticCli({
    arguments_: [phase93FreshCsrfVercelDiagnosticArgument],
    environment: { VERCEL_TOKEN: token },
    historicalStateStore: { read: async () => phase93CompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async () => {
      credentialReads += 1;
      return token;
    },
    readSnapshot_: async () => {
      remoteReads += 1;
      return freshBaselineSnapshot();
    },
    stateStore: { read: async () => undefined },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 1);
  assert.equal(credentialReads, 0);
  assert.equal(remoteReads, 0);
  assert.match(stdout, /^token_format_exact\|f$/mu);
  assert.match(stdout, /^request_count\|0$/mu);
  assert.doesNotMatch(stdout, new RegExp(token, "u"));
});

test("fresh-CSRF wrapper rejects a legacy confirmation before any I/O", async () => {
  let touched = false;
  let stderr = "";
  const code = await runPhase93FreshCsrfVercelOneShotCli({
    arguments_: [
      "preflight",
      "--confirm-hosted-vercel-phase-93-0023-serial-one-shot-neil0619s-projects",
    ],
    historicalStateStore: { read: async () => (touched = true) },
    inspectGit_: async () => (touched = true),
    readSnapshot_: async () => (touched = true),
    stateStore: { read: async () => (touched = true), write: async () => (touched = true) },
    writeError: (value) => (stderr += value),
  });
  assert.equal(code, 1);
  assert.equal(touched, false);
  assert.equal(stderr, "Hosted Phase 93 fresh-CSRF Vercel one-shot gate failed.\n");
});

test("all historical and fresh-CSRF state files coexist without overwrite", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-phase-93-fresh-csrf-"));
  const platformOptions =
    process.platform === "win32"
      ? { directorySync: async () => undefined, privateModeMatches: () => true }
      : {};
  try {
    const identities = [undefined, "phase-92-0022", "phase-93-0023", "phase-93-0023-fresh-csrf"];
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
      ],
    );
    assert.deepEqual(await stores[2].read(), { contract: "state-2" });
    assert.deepEqual(await stores[3].read(), { contract: "state-3" });
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
