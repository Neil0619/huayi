import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  phase92VercelOneShotConfirmation,
  renderPhase92VercelOneShotPlan,
  runPhase92VercelOneShotCli,
} from "./acceptance-vercel-phase-92-one-shot.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

const candidate = "1111111111111111111111111111111111111111";
const token = "vercel-phase-92-test-token";

function deployment({ createdAt, id, project, sha }) {
  return { createdAt, id, project, sha, state: "READY" };
}

function history(project, count, latest) {
  return [
    latest,
    ...Array.from({ length: count - 1 }, (_, index) =>
      deployment({
        createdAt: 99 - index,
        id: `${project}-baseline-${index}`,
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
      16,
      deployment({
        createdAt: 100,
        id: "dpl_6QeRbqxgA88cFXggKekkr2axH9JM",
        project: "api",
        sha: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
      }),
    ),
    web: history(
      "web",
      9,
      deployment({
        createdAt: 100,
        id: "dpl_V3NzjTYXtH7fb3WC2P6hpWR1twhb",
        project: "web",
        sha: "9b0860a91940e4f78968b3882af91ef5bf923b8a",
      }),
    ),
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
    parent: null,
    upstreamCommit: candidate,
    webArmed: false,
    webConfigIdentity: "b".repeat(64),
  };
}

test("package exposes a separate fixed Phase 92 Vercel one-shot surface", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entries = Object.entries(packageDocument.scripts)
    .filter(([name]) => name.startsWith("acceptance:hosted:phase92:deployment:one-shot:"))
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(entries, [
    [
      "acceptance:hosted:phase92:deployment:one-shot:api:arm:observe",
      `node scripts/acceptance-vercel-phase-92-one-shot.mjs observe-api-arm ${phase92VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase92:deployment:one-shot:api:disarm:verify",
      `node scripts/acceptance-vercel-phase-92-one-shot.mjs verify-api-disarm ${phase92VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase92:deployment:one-shot:plan",
      "node scripts/acceptance-vercel-phase-92-one-shot.mjs plan",
    ],
    [
      "acceptance:hosted:phase92:deployment:one-shot:preflight",
      `node scripts/acceptance-vercel-phase-92-one-shot.mjs preflight ${phase92VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase92:deployment:one-shot:web:arm:observe",
      `node scripts/acceptance-vercel-phase-92-one-shot.mjs observe-web-arm ${phase92VercelOneShotConfirmation}`,
    ],
    [
      "acceptance:hosted:phase92:deployment:one-shot:web:disarm:verify",
      `node scripts/acceptance-vercel-phase-92-one-shot.mjs verify-web-disarm ${phase92VercelOneShotConfirmation}`,
    ],
  ]);
});

test("Phase 92 plan is zero-I/O and names its independent immutable state", async () => {
  let touched = false;
  let stdout = "";
  const code = await runPhase92VercelOneShotCli({
    arguments_: ["plan"],
    environment: new Proxy(
      {},
      {
        get() {
          touched = true;
          throw new Error("environment touched");
        },
      },
    ),
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
  assert.equal(stdout, renderPhase92VercelOneShotPlan());
  assert.match(stdout, /phase-92-0022-state\.json/u);
  assert.match(stdout, /Phase 81 state remains immutable/u);
});

test("Phase 92 preflight uses the shared state machine behind its own confirmation", async () => {
  let written;
  let stdout = "";
  const code = await runPhase92VercelOneShotCli({
    arguments_: ["preflight", phase92VercelOneShotConfirmation],
    environment: { VERCEL_TOKEN: token },
    inspectGit_: async () => gitState(),
    readSnapshot_: async () => baselineSnapshot(),
    stateStore: {
      read: async () => undefined,
      write: async (state) => {
        written = state;
      },
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(written.phase, "preflight-passed");
  assert.equal(written.candidateCommit, candidate);
  assert.equal(stdout, "Hosted Phase 92 Vercel one-shot gate passed: preflight.\n");
});

test("Phase 92 rejects the historical confirmation before local or remote work", async () => {
  let touched = false;
  let stderr = "";
  const code = await runPhase92VercelOneShotCli({
    arguments_: ["preflight", "--confirm-hosted-vercel-serial-one-shot-neil0619s-projects"],
    environment: new Proxy(
      {},
      {
        get() {
          touched = true;
        },
      },
    ),
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
    writeError: (value) => {
      stderr += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(touched, false);
  assert.equal(stderr, "Hosted Phase 92 Vercel one-shot gate failed.\n");
});

test("Phase 81 and Phase 92 evidence coexist without overwrite", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-phase-92-state-"));
  const platformOptions =
    process.platform === "win32"
      ? { directorySync: async () => undefined, privateModeMatches: () => true }
      : {};
  try {
    const historicalStore = createVercelOneShotStateStore({
      ...platformOptions,
      repositoryRoot,
    });
    const phase92Store = createVercelOneShotStateStore({
      ...platformOptions,
      repositoryRoot,
      stateIdentity: "phase-92-0022",
    });
    const historical = { contract: "historical", phase: "complete" };
    const current = { contract: "phase-92", phase: "preflight-passed" };
    await historicalStore.write(historical);
    assert.equal(await phase92Store.read(), undefined);
    await phase92Store.write(current);
    assert.deepEqual(await historicalStore.read(), historical);
    assert.deepEqual(await phase92Store.read(), current);
    assert.deepEqual(
      (await readdir(join(repositoryRoot, "artifacts", "hosted-vercel-one-shot"))).sort(),
      ["phase-81-0014-state.json", "phase-92-0022-state.json"],
    );

    await writeFile(
      join(repositoryRoot, "artifacts", "hosted-vercel-one-shot", "unexpected.json"),
      "{}\n",
      { mode: 0o600 },
    );
    await assert.rejects(phase92Store.read(), /state verification failed/u);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
