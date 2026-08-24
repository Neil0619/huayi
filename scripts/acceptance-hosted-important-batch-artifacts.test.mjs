import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  persistHostedImportantBatchBackup,
  persistHostedImportantBatchRebuild,
} from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedImportantBatchId } from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const temporaryRoots = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "huayi-hosted-backup-artifacts-"));
  temporaryRoots.push(root);
  return root;
}

function batchRoot(root) {
  return join(root, "artifacts", "hosted-important-batch-backups", hostedImportantBatchId);
}

test("backup persistence commits archive before its canonical manifest and leaves only strict evidence", async () => {
  const root = await temporaryRepository();
  const events = [];
  const archive = Buffer.from("opaque-custom-archive");

  await persistHostedImportantBatchBackup({
    candidateCommit,
    now: () => new Date("2026-08-24T08:00:00.000Z"),
    phase: "pre",
    produceArchive: async ({ archivePartialPath }) => {
      events.push("produce");
      await writeFile(archivePartialPath, archive);
    },
    repositoryRoot: root,
    verifyArchive: async ({ archivePartialPath }) => {
      events.push("verify");
      assert.deepEqual(await readFile(archivePartialPath), archive);
    },
  });

  const phaseRoot = join(batchRoot(root), "pre");
  assert.deepEqual((await readdir(phaseRoot)).sort(), ["backup-manifest.json", "database.dump"]);
  assert.deepEqual(await readFile(join(phaseRoot, "database.dump")), archive);
  assert.equal((await stat(phaseRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(join(phaseRoot, "database.dump"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(phaseRoot, "backup-manifest.json"))).mode & 0o777, 0o600);
  const manifestSource = await readFile(join(phaseRoot, "backup-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifestSource, `${JSON.stringify(manifest)}\n`);
  assert.deepEqual(manifest, {
    batchId: hostedImportantBatchId,
    candidateCommit,
    capturedAt: "2026-08-24T08:00:00.000Z",
    connectionProfile: "verify-full-administrator",
    contract: "huayi-hosted-important-batch-logical-backup/v1",
    dumpBytes: archive.byteLength,
    dumpFile: "database.dump",
    dumpFormat: "postgres-custom",
    dumpSha256: "136363a488e673df59998272a299535f4de8038a09acbc667f3ee8805ce1beee",
    migrationHead: "20260823010000",
    phase: "pre",
    projectRef: hostedAcceptanceProjectRef,
  });
  assert.deepEqual(events, ["produce", "verify"]);
});

test("backup persistence rejects dynamic identity and cleans partial or committed files on failure", async () => {
  for (const failureStage of ["produce", "verify"]) {
    const root = await temporaryRepository();
    await assert.rejects(
      persistHostedImportantBatchBackup({
        candidateCommit,
        phase: "post",
        produceArchive: async ({ archivePartialPath }) => {
          await writeFile(archivePartialPath, "partial-sensitive-archive");
          if (failureStage === "produce") throw new Error("private database error");
        },
        repositoryRoot: root,
        verifyArchive: async () => {
          throw new Error("private archive listing");
        },
      }),
    );
    assert.deepEqual(await readdir(join(batchRoot(root), "post")), []);
  }

  await assert.rejects(
    persistHostedImportantBatchBackup({
      candidateCommit: "wrong",
      phase: "pre",
      produceArchive: async () => undefined,
      repositoryRoot: await temporaryRepository(),
      verifyArchive: async () => undefined,
    }),
  );
});

test("backup persistence rejects unknown directory entries before producing an archive", async () => {
  const root = await temporaryRepository();
  const phaseRoot = join(batchRoot(root), "pre");
  await mkdir(phaseRoot, { mode: 0o700, recursive: true });
  await writeFile(join(phaseRoot, "unexpected"), "do-not-overwrite", { mode: 0o600 });
  let produced = false;

  await assert.rejects(
    persistHostedImportantBatchBackup({
      candidateCommit,
      phase: "pre",
      produceArchive: async () => {
        produced = true;
      },
      repositoryRoot: root,
      verifyArchive: async () => undefined,
    }),
    /evidence directory is not empty/u,
  );

  assert.equal(produced, false);
  assert.deepEqual(await readdir(phaseRoot), ["unexpected"]);
});

test("backup persistence rejects a same-size archive mutation during verification", async () => {
  const root = await temporaryRepository();
  await assert.rejects(
    persistHostedImportantBatchBackup({
      candidateCommit,
      phase: "pre",
      produceArchive: ({ archivePartialPath }) => writeFile(archivePartialPath, "first"),
      repositoryRoot: root,
      verifyArchive: ({ archivePartialPath }) => writeFile(archivePartialPath, "other"),
    }),
    /archive changed during verification/u,
  );
  assert.deepEqual(await readdir(join(batchRoot(root), "pre")), []);
});

test("rebuild persistence writes its manifest only after scratch destruction is proven", async () => {
  const root = await temporaryRepository();
  const events = [];
  await persistHostedImportantBatchRebuild({
    candidateCommit,
    now: () => new Date("2026-08-24T08:30:00.000Z"),
    performRebuild: async () => {
      events.push("scratch-destroyed");
      return {
        fictionalSeedExact: true,
        hostedDataAbsent: true,
        migrationChainExact: true,
        runtimeContractExact: true,
        scratchDestroyed: true,
      };
    },
    repositoryRoot: root,
  });

  const rebuildRoot = join(batchRoot(root), "rebuild");
  assert.deepEqual(await readdir(rebuildRoot), ["rebuild-verification.json"]);
  const manifest = JSON.parse(
    await readFile(join(rebuildRoot, "rebuild-verification.json"), "utf8"),
  );
  assert.equal(manifest.scratchDestroyed, true);
  assert.equal(manifest.hostedDataAbsent, true);
  assert.equal(manifest.migrationHead, "20260824010000");
  assert.deepEqual(events, ["scratch-destroyed"]);
});

test("rebuild persistence fails closed and removes its partial when any verdict is false", async () => {
  const root = await temporaryRepository();
  await assert.rejects(
    persistHostedImportantBatchRebuild({
      candidateCommit,
      performRebuild: async () => ({
        fictionalSeedExact: true,
        hostedDataAbsent: true,
        migrationChainExact: true,
        runtimeContractExact: true,
        scratchDestroyed: false,
      }),
      repositoryRoot: root,
    }),
  );
  assert.deepEqual(await readdir(join(batchRoot(root), "rebuild")), []);
});
