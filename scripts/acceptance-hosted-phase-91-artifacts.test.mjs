import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  persistHostedPhase91Backup,
  persistHostedPhase91Rebuild,
} from "./acceptance-hosted-phase-91-artifacts.mjs";
import {
  hostedPhase91BackupArtifactDirectory,
  hostedPhase91BackupId,
} from "./acceptance-hosted-phase-91-backup.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const temporaryRoots = [];
const portableFilesystemOptions =
  process.platform === "win32"
    ? { directorySync: async () => undefined, privateModeMatches: () => true }
    : {};

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "huayi-phase-91-artifacts-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "artifacts"));
  return root;
}

test("Phase 91 artifact writer persists independent pre and post heads without Phase 81 paths", async () => {
  const root = await temporaryRepository();
  for (const { expectedHead, phase } of [
    { expectedHead: "20260824010000", phase: "pre" },
    { expectedHead: "20260825010000", phase: "post" },
  ]) {
    await persistHostedPhase91Backup({
      ...portableFilesystemOptions,
      candidateCommit,
      now: () => new Date("2026-08-26T01:02:03.000Z"),
      phase,
      produceArchive: async ({ archivePartialPath }) => {
        await writeFile(archivePartialPath, `opaque-${phase}-dump`);
      },
      repositoryRoot: root,
      verifyArchive: async ({ archivePartialPath }) => {
        assert.equal(await readFile(archivePartialPath, "utf8"), `opaque-${phase}-dump`);
      },
    });
    const phaseRoot = join(root, hostedPhase91BackupArtifactDirectory, phase);
    assert.deepEqual((await readdir(phaseRoot)).sort(), ["backup-manifest.json", "database.dump"]);
    const manifest = JSON.parse(await readFile(join(phaseRoot, "backup-manifest.json"), "utf8"));
    assert.equal(manifest.batchId, hostedPhase91BackupId);
    assert.equal(manifest.migrationHead, expectedHead);
    assert.equal(manifest.candidateCommit, candidateCommit);
  }
  await assert.rejects(
    readdir(join(root, "artifacts", "hosted-important-batch-backups", "phase-81-0014")),
    { code: "ENOENT" },
  );
});

test("Phase 91 artifact writer persists only an exact 0015 rebuild verdict", async () => {
  const root = await temporaryRepository();
  await persistHostedPhase91Rebuild({
    ...portableFilesystemOptions,
    candidateCommit,
    now: () => new Date("2026-08-26T01:02:03.000Z"),
    performRebuild: async () => ({
      fictionalSeedExact: true,
      hostedDataAbsent: true,
      migrationChainExact: true,
      runtimeContractExact: true,
      scratchDestroyed: true,
    }),
    repositoryRoot: root,
  });
  const manifestPath = join(
    root,
    hostedPhase91BackupArtifactDirectory,
    "rebuild",
    "rebuild-verification.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.batchId, hostedPhase91BackupId);
  assert.equal(manifest.migrationHead, "20260825010000");

  const occupied = await temporaryRepository();
  await assert.rejects(
    persistHostedPhase91Rebuild({
      ...portableFilesystemOptions,
      candidateCommit,
      performRebuild: async () => ({ fictionalSeedExact: true }),
      repositoryRoot: occupied,
    }),
    /rebuild verdict is invalid/u,
  );
});
