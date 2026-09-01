import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  phase93VercelOneShotBaselines,
  phase93VercelOneShotConfirmation,
  renderPhase93VercelOneShotPlan,
  runPhase93VercelOneShotCli,
} from "./acceptance-vercel-phase-93-one-shot.mjs";
import {
  phase93VercelDiagnosticArgument,
  phase93VercelDiagnosticFieldNames,
  runPhase93VercelDiagnosticCli,
} from "./acceptance-vercel-phase-93-one-shot-diagnostic.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

const candidate = "1111111111111111111111111111111111111111";
const token = "vercel-phase-93-test-token";

function deployment({ createdAt, id, project, sha, state = "READY" }) {
  return { createdAt, id, project, sha, state };
}

function history(project, count, latest) {
  return [
    latest,
    ...Array.from({ length: count - 1 }, (_, index) =>
      deployment({
        createdAt: 99 - index,
        id: `${project}-phase93-baseline-${index}`,
        project,
        sha: `${String(index + 1).padStart(2, "0")}`.repeat(20),
      }),
    ),
  ];
}

function baselineSnapshot() {
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
    ),
  };
}

async function readTracedBaselineSnapshot({ fetch_ }) {
  for (let index = 0; index < 5; index += 1) await fetch_();
  return baselineSnapshot();
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

test("package exposes only the independent Phase 93 one-shot and diagnostic surface", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entries = Object.entries(packageDocument.scripts)
    .filter(([name]) => name.startsWith("acceptance:hosted:phase93:deployment:one-shot:"))
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(entries, [
    [
      "acceptance:hosted:phase93:deployment:one-shot:api:arm:observe",
      `node scripts/acceptance-vercel-phase-93-one-shot.mjs observe-api-arm ${phase93VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:deployment:one-shot:api:disarm:verify",
      `node scripts/acceptance-vercel-phase-93-one-shot.mjs verify-api-disarm ${phase93VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:deployment:one-shot:diagnose",
      `node scripts/acceptance-vercel-phase-93-one-shot-diagnostic.mjs ${phase93VercelDiagnosticArgument}`,
    ],
    [
      "acceptance:hosted:phase93:deployment:one-shot:plan",
      "node scripts/acceptance-vercel-phase-93-one-shot.mjs plan",
    ],
    [
      "acceptance:hosted:phase93:deployment:one-shot:preflight",
      `node scripts/acceptance-vercel-phase-93-one-shot.mjs preflight ${phase93VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:deployment:one-shot:web:arm:observe",
      `node scripts/acceptance-vercel-phase-93-one-shot.mjs observe-web-arm ${phase93VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase93:deployment:one-shot:web:disarm:verify",
      `node scripts/acceptance-vercel-phase-93-one-shot.mjs verify-web-disarm ${phase93VercelOneShotConfirmation}`,
    ],
  ]);
});

test("Phase 93 plan and baselines are independent candidates pending fresh diagnosis", async () => {
  assert.deepEqual(phase93VercelOneShotBaselines, {
    api: {
      count: 18,
      latestCommit: "ca6f5bdf9f356b7f6a0f5c56b6e9af52e225b1a8",
      latestDeploymentId: "dpl_H4mWYY3dWd42VVw7FWidTcc3Cwu5",
    },
    web: {
      count: 11,
      latestCommit: "b044dda6b9a4626aa54d962acceb23efb1c4520a",
      latestDeploymentId: "dpl_FQopGTKEn7QJLVTTLo86bGJfuWx1",
    },
  });
  let touched = false;
  let stdout = "";
  const code = await runPhase93VercelOneShotCli({
    arguments_: ["plan"],
    inspectGit_: async () => {
      touched = true;
    },
    readSnapshot_: async () => {
      touched = true;
    },
    stateStore: {
      read: async () => {
        touched = true;
      },
      write: async () => {
        touched = true;
      },
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(touched, false);
  assert.equal(stdout, renderPhase93VercelOneShotPlan());
  assert.match(stdout, /phase-93-0023-state\.json/u);
  assert.match(stdout, /candidate 18 API \/ 11 Web/u);
  assert.match(stdout, /fresh diagnose/u);
  assert.match(stdout, /not Hosted evidence/u);
});

test("Phase 93 preflight accepts only the exact diagnosed candidate baseline", async () => {
  let state;
  const code = await runPhase93VercelOneShotCli({
    arguments_: ["preflight", phase93VercelOneShotConfirmation],
    environment: { VERCEL_TOKEN: token },
    inspectGit_: async () => gitState(),
    readSnapshot_: async () => baselineSnapshot(),
    stateStore: {
      read: async () => state,
      write: async (value) => {
        state = value;
      },
    },
  });
  assert.equal(code, 0);
  assert.equal(state.phase, "preflight-passed");
  assert.equal(state.candidateCommit, candidate);

  let written = false;
  const stale = baselineSnapshot();
  stale.api.shift();
  assert.equal(
    await runPhase93VercelOneShotCli({
      arguments_: ["preflight", phase93VercelOneShotConfirmation],
      environment: { VERCEL_TOKEN: token },
      inspectGit_: async () => gitState(),
      readSnapshot_: async () => stale,
      stateStore: {
        read: async () => undefined,
        write: async () => {
          written = true;
        },
      },
    }),
    1,
  );
  assert.equal(written, false);
});

test("Phase 93 diagnostic is read-only, ordered, sanitized, and proves the candidate", async () => {
  let writes = 0;
  let stdout = "";
  const code = await runPhase93VercelDiagnosticCli({
    arguments_: [phase93VercelDiagnosticArgument],
    environment: { VERCEL_TOKEN: token },
    fetch_: async () => ({ status: 200 }),
    inspectGit_: async () => gitState(),
    readSnapshot_: readTracedBaselineSnapshot,
    stateStore: {
      read: async () => undefined,
      write: async () => {
        writes += 1;
      },
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(writes, 0);
  assert.deepEqual(
    stdout
      .trimEnd()
      .split("\n")
      .map((line) => line.split("|")[0]),
    phase93VercelDiagnosticFieldNames,
  );
  const outputLines = new Set(stdout.trimEnd().split("\n"));
  for (const line of [
    "credential_valid|t",
    "request_1_stage|resolve-team",
    "request_1_status|200",
    "request_2_stage|inspect-api",
    "request_2_status|200",
    "request_3_stage|deployments-api",
    "request_3_status|200",
    "request_4_stage|inspect-web",
    "request_4_status|200",
    "request_5_stage|deployments-web",
    "request_5_status|200",
    "request_count|5",
    "state_absent|t",
    "git_contract_exact|t",
    "api_non_canceled_count|18",
    "api_latest_commit_candidate|t",
    "api_latest_state|READY",
    "web_non_canceled_count|11",
    "web_latest_commit_candidate|t",
    "web_latest_state|READY",
    "candidate_baseline_exact|t",
    "contract_exact|t",
    "state_write_attempted|f",
  ]) {
    assert.equal(outputLines.has(line), true, `missing diagnostic line: ${line}`);
  }
  assert.doesNotMatch(stdout, new RegExp(`${token}|dpl_|${candidate}`, "u"));
});

test("Phase 93 diagnostic identifies the failed read-only request without response data", async () => {
  let stdout = "";
  const code = await runPhase93VercelDiagnosticCli({
    arguments_: [phase93VercelDiagnosticArgument],
    environment: { VERCEL_TOKEN: token },
    fetch_: async () => ({ status: 403 }),
    inspectGit_: async () => gitState(),
    readSnapshot_: async ({ fetch_ }) => {
      await fetch_();
      throw new Error("private-response-contract");
    },
    stateStore: { read: async () => undefined },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.match(stdout, /^credential_valid\|f$/mu);
  assert.match(stdout, /^request_1_stage\|resolve-team$/mu);
  assert.match(stdout, /^request_1_status\|403$/mu);
  assert.match(stdout, /^request_2_status\|not_run$/mu);
  assert.match(stdout, /^request_count\|1$/mu);
  assert.match(stdout, /^snapshot_readable\|f$/mu);
  assert.match(stdout, /^contract_exact\|f$/mu);
  assert.doesNotMatch(stdout, new RegExp(`${token}|private-response-contract`, "u"));
});

test("Phase 93 diagnostic fails Git equality closed when inspection is unreadable", async () => {
  let stdout = "";
  const code = await runPhase93VercelDiagnosticCli({
    arguments_: [phase93VercelDiagnosticArgument],
    environment: { VERCEL_TOKEN: token },
    fetch_: async () => ({ status: 200 }),
    inspectGit_: async () => {
      throw new Error("private-git-failure");
    },
    readSnapshot_: readTracedBaselineSnapshot,
    stateStore: { read: async () => undefined },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.match(stdout, /^git_readable\|f$/mu);
  assert.match(stdout, /^git_commit_exact\|f$/mu);
  assert.match(stdout, /^git_contract_exact\|f$/mu);
  assert.match(stdout, /^contract_exact\|f$/mu);
  assert.doesNotMatch(stdout, /private-git-failure/u);
});

test("Phase 81, 92, and 93 state evidence coexist without overwrite", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-phase-93-state-"));
  const platformOptions =
    process.platform === "win32"
      ? { directorySync: async () => undefined, privateModeMatches: () => true }
      : {};
  try {
    const stores = [undefined, "phase-92-0022", "phase-93-0023"].map((stateIdentity) =>
      createVercelOneShotStateStore({
        ...platformOptions,
        repositoryRoot,
        ...(stateIdentity === undefined ? {} : { stateIdentity }),
      }),
    );
    await stores[0].write({ contract: "phase-81" });
    await stores[1].write({ contract: "phase-92" });
    await stores[2].write({ contract: "phase-93" });
    assert.deepEqual(await stores[0].read(), { contract: "phase-81" });
    assert.deepEqual(await stores[1].read(), { contract: "phase-92" });
    assert.deepEqual(await stores[2].read(), { contract: "phase-93" });
    assert.deepEqual(
      (await readdir(join(repositoryRoot, "artifacts", "hosted-vercel-one-shot"))).sort(),
      ["phase-81-0014-state.json", "phase-92-0022-state.json", "phase-93-0023-state.json"],
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
