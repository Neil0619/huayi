import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHostedReleaseState } from "./acceptance-hosted-release-contract.mjs";
import { createHostedReleaseStateStore } from "./acceptance-hosted-release-state.mjs";

const candidateSha = "b".repeat(40);

test("release state store writes canonical private state atomically under the exact release", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-state-"));
  const store = createHostedReleaseStateStore({ candidateSha, repositoryRoot });
  const state = createHostedReleaseState({ candidateSha, now: 100 });

  const release = await store.acquire();
  await store.write(state);
  await release();

  assert.deepEqual(await store.read(), state);
  assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(store.statePath)).mode & 0o777, 0o600);
  assert.equal(await readFile(store.statePath, "utf8"), `${JSON.stringify(state)}\n`);
});

test("release state store lock is exclusive and recoverable only when its owner is dead", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "huayi-release-lock-"));
  const store = createHostedReleaseStateStore({
    candidateSha,
    hostname: "test-host",
    isProcessRunning: (pid) => pid === 10,
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
  const store = createHostedReleaseStateStore({ candidateSha, repositoryRoot });
  const release = await store.acquire();
  await store.write(createHostedReleaseState({ candidateSha, now: 100 }));
  await release();

  await writeFile(store.statePath, `${JSON.stringify({ candidateSha })}\n`, { mode: 0o600 });
  await assert.rejects(store.read(), /Hosted acceptance release state failed closed/u);
});
