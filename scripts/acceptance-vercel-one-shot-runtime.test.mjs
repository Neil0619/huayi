import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createVercelOneShotStateStore,
  runVercelOneShotCli,
  vercelOneShotConfirmation,
} from "./acceptance-vercel-one-shot.mjs";

const token = "vercel-one-shot-test-token";
const candidate = "1111111111111111111111111111111111111111";
const remoteSecret = "remote-secret-must-not-be-reflected";

test("package exposes only the fixed one-shot plan and five transition commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entries = Object.entries(packageJson.scripts).filter(([name]) =>
    name.startsWith("acceptance:hosted:deployment:one-shot:"),
  );
  assert.deepEqual(entries, [
    [
      "acceptance:hosted:deployment:one-shot:api:arm:observe",
      "node scripts/acceptance-vercel-one-shot.mjs observe-api-arm --confirm-hosted-vercel-serial-one-shot-neil0619s-projects",
    ],
    [
      "acceptance:hosted:deployment:one-shot:api:disarm:verify",
      "node scripts/acceptance-vercel-one-shot.mjs verify-api-disarm --confirm-hosted-vercel-serial-one-shot-neil0619s-projects",
    ],
    [
      "acceptance:hosted:deployment:one-shot:plan",
      "node scripts/acceptance-vercel-one-shot.mjs plan",
    ],
    [
      "acceptance:hosted:deployment:one-shot:preflight",
      "node scripts/acceptance-vercel-one-shot.mjs preflight --confirm-hosted-vercel-serial-one-shot-neil0619s-projects",
    ],
    [
      "acceptance:hosted:deployment:one-shot:web:arm:observe",
      "node scripts/acceptance-vercel-one-shot.mjs observe-web-arm --confirm-hosted-vercel-serial-one-shot-neil0619s-projects",
    ],
    [
      "acceptance:hosted:deployment:one-shot:web:disarm:verify",
      "node scripts/acceptance-vercel-one-shot.mjs verify-web-disarm --confirm-hosted-vercel-serial-one-shot-neil0619s-projects",
    ],
  ]);
});

test("CLI plan is zero I/O and stage output never reflects token or remote detail", async () => {
  let stdout = "";
  let stderr = "";
  let touched = false;
  const planCode = await runVercelOneShotCli({
    arguments_: ["plan"],
    environment: new Proxy(
      {},
      {
        get() {
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
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(planCode, 0);
  assert.equal(touched, false);
  assert.equal(stderr, "");
  assert.match(stdout, /serial one-shot gate/u);

  stdout = "";
  stderr = "";
  const failureCode = await runVercelOneShotCli({
    arguments_: ["preflight", vercelOneShotConfirmation],
    environment: { VERCEL_TOKEN: token },
    inspectGit_: async () => {
      throw new Error(remoteSecret);
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(failureCode, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted Vercel one-shot gate failed.\n");
  assert.doesNotMatch(stderr, new RegExp(`${token}|${remoteSecret}`, "u"));
});

test("CLI validates persisted state before Git, environment, or remote reads", async () => {
  let touched = false;
  let stderr = "";
  const code = await runVercelOneShotCli({
    arguments_: ["observe-api-arm", vercelOneShotConfirmation],
    environment: new Proxy(
      {},
      {
        get() {
          touched = true;
          return token;
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
      read: async () => ({ contract: "tampered" }),
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
  assert.equal(stderr, "Hosted Vercel one-shot gate failed.\n");
});

test("state evidence is canonical, private, atomic, and never contains the Vercel token", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-one-shot-"));
  try {
    const store = createVercelOneShotStateStore({
      ...(process.platform === "win32"
        ? { directorySync: async () => undefined, privateModeMatches: () => true }
        : {}),
      repositoryRoot,
    });
    assert.equal(await store.read(), undefined);
    const state = {
      audits: { api: [], web: [] },
      baseline: { api: [], web: [] },
      candidateCommit: candidate,
      configIdentities: { api: "a".repeat(64), web: "b".repeat(64) },
      contract: "huayi-hosted-vercel-serial-one-shot/v1",
      phase: "preflight-passed",
    };
    await store.write(state);
    assert.deepEqual(await store.read(), state);
    const directory = join(repositoryRoot, "artifacts", "hosted-vercel-one-shot");
    const statePath = join(directory, "phase-81-0014-state.json");
    if (process.platform !== "win32") {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    }
    const source = await readFile(statePath, "utf8");
    assert.equal(source, `${JSON.stringify(state)}\n`);
    assert.doesNotMatch(source, new RegExp(token, "u"));
    if (process.platform !== "win32") {
      await chmod(statePath, 0o644);
      await assert.rejects(store.read(), /state verification failed/u);
    }
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("state evidence writes beside an existing shared artifacts root", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-one-shot-existing-root-"));
  try {
    const sibling = join(repositoryRoot, "artifacts", "other-evidence");
    await mkdir(sibling, { recursive: true });
    const store = createVercelOneShotStateStore({
      ...(process.platform === "win32"
        ? { directorySync: async () => undefined, privateModeMatches: () => true }
        : {}),
      repositoryRoot,
    });
    await store.write({ contract: "shared-artifacts-root" });
    const nextState = { contract: "existing-private-state-directory" };
    await store.write(nextState);
    assert.deepEqual(await store.read(), nextState);
    assert.equal((await stat(sibling)).isDirectory(), true);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("state evidence uses the injected directory durability boundary", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-vercel-one-shot-sync-"));
  try {
    const store = createVercelOneShotStateStore({
      directorySync: async () => {
        throw new Error("injected sync failure");
      },
      repositoryRoot,
    });

    await assert.rejects(
      store.write({ contract: "durability-boundary" }),
      /state verification failed/u,
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
