import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hostedImportantBatchRebuildRetirementArgument,
  hostedImportantBatchRebuildRetirementHistoryDirectory,
  readHostedImportantBatchRebuildRetirementRepositoryState,
  retireHostedImportantBatchRebuild,
  runHostedImportantBatchRebuildRetirementCli,
} from "./acceptance-hosted-important-batch-rebuild-retirement.mjs";
import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchId,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { inspectHostedImportantBatchEvidence } from "./acceptance-hosted-important-batch-status.mjs";

const currentCommit = "0123456789abcdef0123456789abcdef01234567";
const staleCommit = "fedcba9876543210fedcba9876543210fedcba98";
const portableFilesystemOptions =
  process.platform === "win32" ? { directorySync: async () => undefined } : {};

function manifest() {
  return {
    batchId: hostedImportantBatchId,
    candidateCommit: staleCommit,
    completedAt: "2026-08-25T01:00:00.000Z",
    contract: "huayi-hosted-important-batch-rebuild-verification/v1",
    fictionalSeedExact: true,
    hostedDataAbsent: true,
    migrationChainExact: true,
    migrationHead: "20260824010000",
    projectRef: hostedAcceptanceProjectRef,
    rebuildSource: "repository-migrations-and-fictional-seed",
    runtimeContractExact: true,
    scratchDestroyed: true,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "huayi-rebuild-retirement-"));
  const activeBatch = join(root, hostedImportantBatchBackupArtifactDirectory);
  const activeRebuild = join(activeBatch, "rebuild");
  await mkdir(activeRebuild, { mode: 0o700, recursive: true });
  await chmod(join(root, "artifacts", "hosted-important-batch-backups"), 0o700);
  await chmod(activeBatch, 0o700);
  await chmod(activeRebuild, 0o700);
  const manifestPath = join(activeRebuild, "rebuild-verification.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest())}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o600);
  const modeOverrides = new Map();
  const evidenceIo = {
    async lstat(path) {
      const stats = await lstat(path);
      return {
        isDirectory: () => stats.isDirectory(),
        isFile: () => stats.isFile(),
        mode:
          modeOverrides.get(path) ??
          (stats.isDirectory() ? 0o700 : stats.isFile() ? 0o600 : stats.mode),
        size: stats.size,
      };
    },
    readFile,
    readdir,
  };
  const state = {
    artifactRootIgnored: true,
    candidateCommit: currentCommit,
    historyRootIgnored: true,
    upstreamExact: true,
    worktreeClean: true,
  };
  return { activeBatch, activeRebuild, evidenceIo, manifestPath, modeOverrides, root, state };
}

async function removeFixture(fixture) {
  await rm(fixture.root, { force: true, recursive: true });
}

function historyPaths(fixture) {
  const historyBatch = join(
    fixture.root,
    hostedImportantBatchRebuildRetirementHistoryDirectory,
    hostedImportantBatchId,
  );
  const candidateRoot = join(historyBatch, staleCommit);
  return {
    candidateRoot,
    historyBatch,
    retainedManifest: join(candidateRoot, "rebuild", "rebuild-verification.json"),
  };
}

async function mode(fixture, path) {
  return (await fixture.evidenceIo.lstat(path)).mode & 0o777;
}

test("retirement atomically retains stale strict rebuild evidence outside the active batch", async () => {
  const fixture = await createFixture();
  try {
    const original = await readFile(fixture.manifestPath, "utf8");
    await retireHostedImportantBatchRebuild({
      ...portableFilesystemOptions,
      evidenceIo: fixture.evidenceIo,
      readRepositoryState: async () => fixture.state,
      repositoryRoot: fixture.root,
    });

    assert.deepEqual(await readdir(fixture.activeBatch), []);
    const status = await inspectHostedImportantBatchEvidence({
      evidenceIo: fixture.evidenceIo,
      readRepositoryState: async () => ({
        artifactRootIgnored: true,
        candidateCommit: currentCommit,
        worktreeClean: true,
      }),
      repositoryRoot: fixture.root,
    });
    assert.deepEqual(status.rebuild, { current: false, present: false, valid: false });
    const retained = historyPaths(fixture);
    assert.equal(await readFile(retained.retainedManifest, "utf8"), original);
    assert.equal(await mode(fixture, retained.historyBatch), 0o700);
    assert.equal(await mode(fixture, retained.candidateRoot), 0o700);
    assert.equal(await mode(fixture, join(retained.candidateRoot, "rebuild")), 0o700);
    assert.equal(await mode(fixture, retained.retainedManifest), 0o600);
  } finally {
    await removeFixture(fixture);
  }
});

test("retirement fails closed for current, unsafe, malformed, occupied, or ambiguous evidence", async () => {
  const cases = [
    async (fixture) => ({ ...fixture.state, candidateCommit: staleCommit }),
    async (fixture) => ({ ...fixture.state, worktreeClean: false }),
    async (fixture) => ({ ...fixture.state, upstreamExact: false }),
    async (fixture) => ({ ...fixture.state, artifactRootIgnored: false }),
    async (fixture) => ({ ...fixture.state, historyRootIgnored: false }),
    async (fixture) => {
      await writeFile(join(fixture.activeRebuild, "unexpected"), "secret", { mode: 0o600 });
      return fixture.state;
    },
    async (fixture) => {
      fixture.modeOverrides.set(fixture.manifestPath, 0o644);
      return fixture.state;
    },
    async (fixture) => {
      await writeFile(fixture.manifestPath, '{"private":"identity"}\n', { mode: 0o600 });
      return fixture.state;
    },
    async (fixture) => {
      await mkdir(historyPaths(fixture).candidateRoot, { mode: 0o700, recursive: true });
      return fixture.state;
    },
  ];

  for (const arrange of cases) {
    const fixture = await createFixture();
    try {
      const state = await arrange(fixture);
      await assert.rejects(
        retireHostedImportantBatchRebuild({
          evidenceIo: fixture.evidenceIo,
          readRepositoryState: async () => state,
          repositoryRoot: fixture.root,
        }),
      );
      assert.equal(
        await readFile(fixture.manifestPath, "utf8").then(
          () => true,
          () => false,
        ),
        true,
      );
    } finally {
      await removeFixture(fixture);
    }
  }
});

test("rename, directory-sync, and post-move validation failures preserve evidence", async () => {
  for (const failure of ["rename", "sync-before", "sync-after", "tamper-after"]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        retireHostedImportantBatchRebuild({
          directorySync: async (path) => {
            if (failure === "sync-before" && path === historyPaths(fixture).historyBatch) {
              throw new Error("private-before");
            }
            if (failure === "sync-after" && path === fixture.activeBatch) {
              throw new Error("private-after");
            }
            if (failure === "tamper-after" && path === historyPaths(fixture).candidateRoot) {
              await writeFile(historyPaths(fixture).retainedManifest, '{"private":"identity"}\n', {
                mode: 0o600,
              });
            }
          },
          evidenceIo: fixture.evidenceIo,
          readRepositoryState: async () => fixture.state,
          renameLeaf:
            failure === "rename"
              ? async () => {
                  throw new Error("private-rename");
                }
              : undefined,
          repositoryRoot: fixture.root,
        }),
      );
      const retained = historyPaths(fixture);
      const copies = await Promise.all(
        [fixture.manifestPath, retained.retainedManifest].map((path) =>
          readFile(path, "utf8").then(
            () => true,
            () => false,
          ),
        ),
      );
      assert.equal(copies.some(Boolean), true);
    } finally {
      await removeFixture(fixture);
    }
  }
});

test("repository inspection requires clean HEAD=upstream and both evidence roots ignored", async () => {
  const calls = [];
  const result = await readHostedImportantBatchRebuildRetirementRepositoryState(
    "/fixed/repository",
    {
      runGit: async (arguments_) => {
        calls.push(arguments_);
        if (arguments_[0] === "status" || arguments_[0] === "check-ignore") {
          return { code: 0, stdout: "" };
        }
        return { code: 0, stdout: `${currentCommit}\n` };
      },
    },
  );
  assert.deepEqual(result, {
    artifactRootIgnored: true,
    candidateCommit: currentCommit,
    historyRootIgnored: true,
    upstreamExact: true,
    worktreeClean: true,
  });
  assert.equal(calls.filter((arguments_) => arguments_[0] === "check-ignore").length, 2);
  assert.equal(
    calls.some((arguments_) => arguments_.includes("@{upstream}")),
    true,
  );
});

test("retirement CLI is exact, body-free, and never reflects private failures", async () => {
  const secret = "private-user@example.test";
  for (const candidate of [
    { arguments_: [hostedImportantBatchRebuildRetirementArgument, secret] },
    {
      arguments_: [hostedImportantBatchRebuildRetirementArgument],
      retireEvidence: async () => {
        throw new Error(secret);
      },
    },
  ]) {
    let stderr = "";
    let stdout = "";
    const code = await runHostedImportantBatchRebuildRetirementCli({
      ...candidate,
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /failed closed/u);
    assert.doesNotMatch(stderr, new RegExp(secret, "u"));
  }
});

test("retirement CLI reports one fixed body-free success", async () => {
  let stdout = "";
  const code = await runHostedImportantBatchRebuildRetirementCli({
    arguments_: [hostedImportantBatchRebuildRetirementArgument],
    retireEvidence: async () => undefined,
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(stdout, "Hosted important-batch stale rebuild evidence retired.\n");
});

test("package exposes only the fixed stale rebuild retirement confirmation", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:rebuild:retire"],
    `node scripts/acceptance-hosted-important-batch-rebuild-retirement.mjs ${hostedImportantBatchRebuildRetirementArgument}`,
  );
});
