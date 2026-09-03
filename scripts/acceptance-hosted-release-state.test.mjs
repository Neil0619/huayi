import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getFileInfo } from "prettier";

import { createHostedReleaseState } from "./acceptance-hosted-release-contract.mjs";
import { createHostedReleaseStateStore } from "./acceptance-hosted-release-state.mjs";

const candidateSha = "b".repeat(40);
const releaseAttemptId = `hosted-attempt-${"c".repeat(32)}`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portablePrivateModeOptions =
  process.platform === "win32" ? { privateModeMatches: () => true } : {};

function legacyCompleteState() {
  return {
    apiDeploymentId: "dpl_api_legacy_123",
    branch: "codex/settings-configuration",
    candidateSha,
    ciRunId: 42,
    createdAt: 100,
    phase: "complete",
    releaseId: `hosted-acceptance-${candidateSha}`,
    schemaVersion: 1,
    updatedAt: 200,
    webDeploymentId: "dpl_web_legacy_123",
  };
}

function legacyAttemptCompleteState() {
  return {
    ...legacyCompleteState(),
    releaseAttemptId,
    schemaVersion: 2,
  };
}

test("release state stays outside repository formatting inputs", async () => {
  const statePath = join(
    repositoryRoot,
    "artifacts",
    "hosted-release",
    `hosted-acceptance-${candidateSha}`,
    "state.json",
  );

  assert.equal(
    (await getFileInfo(statePath, { ignorePath: join(repositoryRoot, ".prettierignore") })).ignored,
    true,
  );
});

test("release state accepts an injected private-mode policy for non-POSIX test filesystems", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-portable-mode-"));
  const store = createHostedReleaseStateStore({
    candidateSha,
    privateModeMatches: () => true,
    repositoryRoot,
  });
  try {
    await mkdir(store.directory, { mode: 0o755, recursive: true });
    await chmod(dirname(store.directory), 0o755);
    await chmod(store.directory, 0o755);

    const release = await store.acquire();
    await release();
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("release state store writes canonical private state atomically under the exact release", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-state-"));
  const store = createHostedReleaseStateStore({
    candidateSha,
    ...portablePrivateModeOptions,
    repositoryRoot,
  });
  const state = createHostedReleaseState({ candidateSha, now: 100, releaseAttemptId });

  const release = await store.acquire();
  await store.write(state);
  await release();

  assert.deepEqual(await store.read(), state);
  if (process.platform !== "win32") {
    assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(store.statePath)).mode & 0o777, 0o600);
  }
  assert.equal(await readFile(store.statePath, "utf8"), `${JSON.stringify(state)}\n`);
});

test("release state store lock is exclusive and recoverable only when its owner is dead", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-lock-"));
  const store = createHostedReleaseStateStore({
    candidateSha,
    hostname: "test-host",
    isProcessRunning: (pid) => pid === 10,
    ...portablePrivateModeOptions,
    processId: 10,
    repositoryRoot,
  });
  const release = await store.acquire();
  await assert.rejects(store.acquire(), /Hosted acceptance release state failed closed/u);
  await release();

  await writeFile(
    store.lockPath,
    `${JSON.stringify({ hostname: "test-host", pid: 11, releaseId: store.releaseId })}\n`,
    { mode: 0o600 },
  );
  const recovered = await store.acquire({ recover: true });
  await recovered();
});

test("release state store rejects malformed, noncanonical, and cross-candidate state", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-invalid-"));
  const store = createHostedReleaseStateStore({
    candidateSha,
    ...portablePrivateModeOptions,
    repositoryRoot,
  });
  const release = await store.acquire();
  await store.write(createHostedReleaseState({ candidateSha, now: 100, releaseAttemptId }));
  await release();

  await writeFile(store.statePath, `${JSON.stringify({ candidateSha })}\n`, { mode: 0o600 });
  await assert.rejects(store.read(), /Hosted acceptance release state failed closed/u);
});

test("release status can still read existing schema-v1 and schema-v2 complete states", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-legacy-state-"));
  const store = createHostedReleaseStateStore({
    candidateSha,
    ...portablePrivateModeOptions,
    repositoryRoot,
  });
  try {
    const release = await store.acquire();
    await release();
    for (const state of [legacyCompleteState(), legacyAttemptCompleteState()]) {
      await writeFile(store.statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      assert.deepEqual(await store.read(), state);
    }
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
