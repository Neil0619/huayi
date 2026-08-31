import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hostedPhase92ArtifactContract,
  hostedPhase93ArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  persistHostedPhase93MigrationBackup,
  persistHostedPhase93MigrationRebuild,
} from "./acceptance-hosted-phase-93-migration-artifacts.mjs";
import {
  hostedPhase93MigrationBackupArtifactDirectory,
  hostedPhase93MigrationBackupCompletionArgument,
  hostedPhase93MigrationBackupHistoricalCompletionArgument,
  hostedPhase93MigrationBackupId,
  hostedPhase93MigrationBackupPreflightArgument,
  renderHostedPhase93MigrationBackupPlan,
  runHostedPhase93MigrationBackupCli,
} from "./acceptance-hosted-phase-93-migration-backup.mjs";
import {
  hostedPhase93MigrationPostCaptureReadinessArgument,
  hostedPhase93MigrationPreCaptureReadinessArgument,
  hostedPhase93MigrationRebuildReadinessArgument,
  runHostedPhase93MigrationBackupExecutorCli,
} from "./acceptance-hosted-phase-93-migration-backup-executor.mjs";
import { hostedPhase93MigrationBackupStatusArgument } from "./acceptance-hosted-phase-93-migration-backup-status.mjs";
import {
  hostedPhase93MigrationCapturePostArgument,
  hostedPhase93MigrationCapturePreArgument,
} from "./acceptance-hosted-phase-93-migration-capture.mjs";
import {
  hostedPhase93MigrationRebuildArgument,
  loadHostedPhase93MigrationRebuildSources,
} from "./acceptance-hosted-phase-93-migration-rebuild.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const temporaryRoots = [];
const portableFilesystemOptions =
  process.platform === "win32"
    ? { directorySync: async () => undefined, privateModeMatches: () => true }
    : {};
const portableEvidenceIo = Object.freeze({
  async hashFile(path) {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  },
  async lstat(path) {
    const stats = await lstat(path);
    return {
      isDirectory: () => stats.isDirectory(),
      isFile: () => stats.isFile(),
      mode: stats.isDirectory() ? 0o700 : 0o600,
      size: stats.size,
    };
  },
  readFile,
  readdir,
});

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createTemporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "seen-said-phase-93-migration-batch-"));
  temporaryRoots.push(root);
  return root;
}

test("Phase 93 owns a distinct 23-file evidence identity", async () => {
  assert.equal(hostedPhase92ArtifactContract.migrationFiles.length, 22);
  assert.equal(hostedPhase93ArtifactContract.migrationFiles.length, 23);
  assert.equal(hostedPhase93ArtifactContract.preMigrationHead, "20260828010000");
  assert.equal(hostedPhase93ArtifactContract.postMigrationHead, "20260831010000");
  assert.equal(
    hostedPhase93ArtifactContract.migrationFiles.at(-1),
    "20260831010000_invitation_token_recovery.sql",
  );
  assert.notEqual(
    hostedPhase93ArtifactContract.artifactDirectory,
    hostedPhase92ArtifactContract.artifactDirectory,
  );
  const sources = await loadHostedPhase93MigrationRebuildSources(process.cwd());
  assert.equal(sources.migrations.length, 23);
  assert.equal(sources.migrations.at(-1).version, "20260831010000");
  assert.equal(hostedPhase93MigrationBackupId, "phase-93-0023-invitation-token-recovery");
  assert.equal(
    hostedPhase93MigrationBackupArtifactDirectory,
    "artifacts/hosted-important-batch-backups/phase-93-0023-invitation-token-recovery",
  );
});

test("Phase 93 evidence closes the exact current and immutable historical batch", async () => {
  const repositoryRoot = await createTemporaryRepository();
  const persistBackup = (phase) =>
    persistHostedPhase93MigrationBackup({
      ...portableFilesystemOptions,
      candidateCommit,
      now: () =>
        new Date(phase === "pre" ? "2026-08-31T08:00:00.000Z" : "2026-08-31T08:02:00.000Z"),
      phase,
      produceArchive: ({ archivePartialPath }) =>
        writeFile(archivePartialPath, `opaque-${phase}-database-dump`),
      repositoryRoot,
      verifyArchive: async () => undefined,
    });
  await persistBackup("pre");
  await persistHostedPhase93MigrationRebuild({
    ...portableFilesystemOptions,
    candidateCommit,
    now: () => new Date("2026-08-31T08:01:00.000Z"),
    performRebuild: async () => ({
      fictionalSeedExact: true,
      hostedDataAbsent: true,
      migrationChainExact: true,
      runtimeContractExact: true,
      scratchDestroyed: true,
    }),
    repositoryRoot,
  });
  const repositoryState = {
    artifactRootIgnored: true,
    candidateCommit,
    upstreamExact: true,
    worktreeClean: true,
  };
  const historicalRepositoryState = {
    artifactRootIgnored: true,
    currentCommit: "89abcdef0123456789abcdef0123456789abcdef",
    historicalCandidateCommit: candidateCommit,
    historicalCandidateExists: true,
    historicalCandidateIsAncestor: true,
    upstreamExact: true,
    worktreeClean: true,
  };
  const runGate = async (argument) => {
    let stderr = "";
    let stdout = "";
    const code = await runHostedPhase93MigrationBackupCli({
      arguments_: [argument],
      evidenceIo: portableEvidenceIo,
      readHistoricalRepositoryState: async () => historicalRepositoryState,
      readRepositoryState: async () => repositoryState,
      repositoryRoot,
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    return { code, stderr, stdout };
  };

  assert.deepEqual(await runGate(hostedPhase93MigrationBackupPreflightArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted Phase 93 migration backup preflight evidence passed.\n",
  });
  assert.equal((await runGate(hostedPhase93MigrationBackupCompletionArgument)).code, 1);

  await persistBackup("post");
  assert.deepEqual(await runGate(hostedPhase93MigrationBackupCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted Phase 93 migration backup completion evidence passed.\n",
  });
  assert.deepEqual(await runGate(hostedPhase93MigrationBackupHistoricalCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted Phase 93 migration historical completion evidence passed.\n",
  });

  historicalRepositoryState.historicalCandidateIsAncestor = false;
  assert.equal((await runGate(hostedPhase93MigrationBackupHistoricalCompletionArgument)).code, 1);
});

test("Phase 93 plan is zero-operation and package exposes every fixed gate", async () => {
  let calls = 0;
  let output = "";
  assert.equal(
    await runHostedPhase93MigrationBackupCli({
      arguments_: ["--plan"],
      readRepositoryState: async () => {
        calls += 1;
      },
      writeOutput: (value) => {
        output += value;
      },
    }),
    0,
  );
  assert.equal(calls, 0);
  assert.equal(output, renderHostedPhase93MigrationBackupPlan());
  assert.match(output, /23 repository migrations/u);
  assert.match(output, /Phase 92 0022 evidence stays immutable/u);

  const scripts = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ).scripts;
  const backup = "node scripts/acceptance-hosted-phase-93-migration-backup.mjs";
  assert.equal(
    scripts["acceptance:hosted:phase93:migration:backup:preflight"],
    `${backup} ${hostedPhase93MigrationBackupPreflightArgument}`,
  );
  assert.equal(
    scripts["acceptance:hosted:phase93:migration:backup:complete"],
    `${backup} ${hostedPhase93MigrationBackupCompletionArgument}`,
  );
  assert.equal(
    scripts["acceptance:hosted:phase93:migration:backup:historical:verify"],
    `${backup} ${hostedPhase93MigrationBackupHistoricalCompletionArgument}`,
  );
  const executor = "node scripts/acceptance-hosted-phase-93-migration-backup-executor.mjs";
  for (const [name, argument] of [
    ["executor:pre:readiness", hostedPhase93MigrationPreCaptureReadinessArgument],
    ["executor:rebuild:readiness", hostedPhase93MigrationRebuildReadinessArgument],
    ["executor:post:readiness", hostedPhase93MigrationPostCaptureReadinessArgument],
    ["capture:pre", hostedPhase93MigrationCapturePreArgument],
    ["rebuild", hostedPhase93MigrationRebuildArgument],
    ["capture:post", hostedPhase93MigrationCapturePostArgument],
  ])
    assert.equal(
      scripts[`acceptance:hosted:phase93:migration:backup:${name}`],
      `${executor} ${argument}`,
    );
  assert.equal(
    scripts["acceptance:hosted:phase93:migration:backup:status"],
    `node scripts/acceptance-hosted-phase-93-migration-backup-status.mjs ${hostedPhase93MigrationBackupStatusArgument}`,
  );
});

test("Phase 93 executor fails before secrets when readiness is not exact", async () => {
  const calls = [];
  const code = await runHostedPhase93MigrationBackupExecutorCli({
    arguments_: [hostedPhase93MigrationCapturePreArgument],
    inspectRuntime: async () => ({
      artifactEncryptionReady: false,
      dockerDaemonReady: false,
      dockerTargetReady: false,
      localPlatformImagesReady: false,
      pinnedPostgres17RuntimeReady: false,
      pinnedScratchRuntimeReady: false,
      platformLockReady: false,
      supabaseCliPinned: false,
    }),
    readCaptureSecrets: async () => {
      calls.push("secrets");
    },
    readRepositoryState: async () => {
      calls.push("repository");
      return {};
    },
    writeError: () => undefined,
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ["repository"]);
});
