import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hostedDeepseekMigrationArtifactContract,
  hostedPhase92ArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  persistHostedPhase92MigrationBackup,
  persistHostedPhase92MigrationRebuild,
} from "./acceptance-hosted-phase-92-migration-artifacts.mjs";
import {
  hostedPhase92MigrationBackupArtifactDirectory,
  hostedPhase92MigrationBackupCompletionArgument,
  hostedPhase92MigrationBackupHistoricalCompletionArgument,
  hostedPhase92MigrationBackupId,
  hostedPhase92MigrationBackupPreflightArgument,
  renderHostedPhase92MigrationBackupPlan,
  runHostedPhase92MigrationBackupCli,
} from "./acceptance-hosted-phase-92-migration-backup.mjs";
import {
  hostedPhase92MigrationPostCaptureReadinessArgument,
  hostedPhase92MigrationPreCaptureReadinessArgument,
  hostedPhase92MigrationRebuildReadinessArgument,
  runHostedPhase92MigrationBackupExecutorCli,
} from "./acceptance-hosted-phase-92-migration-backup-executor.mjs";
import {
  hostedPhase92MigrationCapturePostArgument,
  hostedPhase92MigrationCapturePreArgument,
} from "./acceptance-hosted-phase-92-migration-capture.mjs";
import { hostedPhase92MigrationBackupStatusArgument } from "./acceptance-hosted-phase-92-migration-backup-status.mjs";
import {
  hostedPhase92MigrationRebuildArgument,
  loadHostedPhase92MigrationRebuildSources,
} from "./acceptance-hosted-phase-92-migration-rebuild.mjs";

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

async function createTemporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "seen-said-phase-92-migration-batch-"));
  temporaryRoots.push(root);
  return root;
}

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

test("Phase 92 owns a new 22-file backup identity without rewriting DeepSeek evidence", async () => {
  assert.equal(hostedDeepseekMigrationArtifactContract.migrationFiles.length, 21);
  assert.equal(hostedDeepseekMigrationArtifactContract.rebuildMigrationHead, "20260827060000");
  assert.equal(hostedPhase92ArtifactContract.migrationFiles.length, 22);
  assert.equal(
    hostedPhase92ArtifactContract.migrationFiles.at(-1),
    "20260828010000_password_signup_expired_invitation_recovery.sql",
  );
  assert.equal(hostedPhase92ArtifactContract.preMigrationHead, "20260827060000");
  assert.equal(hostedPhase92ArtifactContract.rebuildMigrationHead, "20260828010000");
  assert.notEqual(
    hostedPhase92ArtifactContract.artifactDirectory,
    hostedDeepseekMigrationArtifactContract.artifactDirectory,
  );

  const sources = await loadHostedPhase92MigrationRebuildSources(process.cwd());
  assert.equal(sources.migrations.length, 22);
  assert.equal(sources.migrations.at(-1).version, "20260828010000");
  assert.match(hostedPhase92MigrationRebuildArgument, /0022/u);
});

test("Phase 92 backup plan and package surface expose only fixed operations", async () => {
  let calls = 0;
  let stdout = "";
  const code = await runHostedPhase92MigrationBackupCli({
    arguments_: ["--plan"],
    evidenceIo: {
      hashFile: async () => {
        calls += 1;
      },
      lstat: async () => {
        calls += 1;
      },
      readFile: async () => {
        calls += 1;
      },
      readdir: async () => {
        calls += 1;
      },
    },
    readRepositoryState: async () => {
      calls += 1;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stdout, renderHostedPhase92MigrationBackupPlan());
  assert.match(stdout, /22 repository migrations/u);
  assert.match(stdout, /20260827060000/u);
  assert.match(stdout, /20260828010000/u);
  assert.match(stdout, /DeepSeek.+immutable/isu);
  assert.match(stdout, /Historical completion.+pushed descendant HEAD/isu);

  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase92:migration:backup:plan"],
    "node scripts/acceptance-hosted-phase-92-migration-backup.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase92:migration:backup:preflight"],
    `node scripts/acceptance-hosted-phase-92-migration-backup.mjs ${hostedPhase92MigrationBackupPreflightArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase92:migration:backup:complete"],
    `node scripts/acceptance-hosted-phase-92-migration-backup.mjs ${hostedPhase92MigrationBackupCompletionArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase92:migration:backup:historical:verify"],
    `node scripts/acceptance-hosted-phase-92-migration-backup.mjs ${hostedPhase92MigrationBackupHistoricalCompletionArgument}`,
  );
  const executor = "node scripts/acceptance-hosted-phase-92-migration-backup-executor.mjs";
  for (const [operation, argument] of [
    ["executor:pre:readiness", hostedPhase92MigrationPreCaptureReadinessArgument],
    ["executor:rebuild:readiness", hostedPhase92MigrationRebuildReadinessArgument],
    ["executor:post:readiness", hostedPhase92MigrationPostCaptureReadinessArgument],
    ["capture:pre", hostedPhase92MigrationCapturePreArgument],
    ["rebuild", hostedPhase92MigrationRebuildArgument],
    ["capture:post", hostedPhase92MigrationCapturePostArgument],
  ]) {
    assert.equal(
      packageDocument.scripts[`acceptance:hosted:phase92:migration:backup:${operation}`],
      `${executor} ${argument}`,
    );
  }
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase92:migration:backup:status"],
    `node scripts/acceptance-hosted-phase-92-migration-backup-status.mjs ${hostedPhase92MigrationBackupStatusArgument}`,
  );
  assert.equal(hostedPhase92MigrationBackupId, "phase-92-0022-expired-invitation-recovery");
  assert.equal(
    hostedPhase92MigrationBackupArtifactDirectory,
    "artifacts/hosted-important-batch-backups/phase-92-0022-expired-invitation-recovery",
  );
});

test("Phase 92 evidence closes the exact current and immutable historical batch", async () => {
  const repositoryRoot = await createTemporaryRepository();
  const persistBackup = (phase) =>
    persistHostedPhase92MigrationBackup({
      ...portableFilesystemOptions,
      candidateCommit,
      now: () =>
        new Date(phase === "pre" ? "2026-08-28T08:00:00.000Z" : "2026-08-28T08:02:00.000Z"),
      phase,
      produceArchive: ({ archivePartialPath }) =>
        writeFile(archivePartialPath, `opaque-${phase}-database-dump`),
      repositoryRoot,
      verifyArchive: async () => undefined,
    });
  await persistBackup("pre");
  await persistHostedPhase92MigrationRebuild({
    ...portableFilesystemOptions,
    candidateCommit,
    now: () => new Date("2026-08-28T08:01:00.000Z"),
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
    const result = await runHostedPhase92MigrationBackupCli({
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
    return { code: result, stderr, stdout };
  };

  assert.deepEqual(await runGate(hostedPhase92MigrationBackupPreflightArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted Phase 92 migration backup preflight evidence passed.\n",
  });
  assert.equal((await runGate(hostedPhase92MigrationBackupCompletionArgument)).code, 1);

  await persistBackup("post");
  assert.deepEqual(await runGate(hostedPhase92MigrationBackupCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted Phase 92 migration backup completion evidence passed.\n",
  });
  assert.deepEqual(await runGate(hostedPhase92MigrationBackupHistoricalCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted Phase 92 migration historical completion evidence passed.\n",
  });

  historicalRepositoryState.historicalCandidateIsAncestor = false;
  assert.equal((await runGate(hostedPhase92MigrationBackupHistoricalCompletionArgument)).code, 1);
});

test("Phase 92 executor gates secrets and writes behind pushed readiness", async () => {
  const calls = [];
  const readyRuntime = {
    artifactEncryptionReady: true,
    dockerDaemonReady: true,
    dockerTargetReady: true,
    localPlatformImagesReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: true,
    platformLockReady: true,
    supabaseCliPinned: true,
  };
  const runExecutor = (argument, upstreamExact) =>
    runHostedPhase92MigrationBackupExecutorCli({
      arguments_: [argument],
      captureBackup: async () => {
        calls.push("capture");
      },
      inspectRuntime: async () => {
        calls.push("runtime");
        return readyRuntime;
      },
      environment: {},
      readCaptureSecrets: async () => {
        calls.push("secrets");
        return { administratorPassword: "private", caCertificate: "private" };
      },
      readRepositoryState: async () => {
        calls.push("repository");
        return {
          artifactRootIgnored: true,
          candidateCommit,
          upstreamExact,
          worktreeClean: true,
        };
      },
      writeError: () => undefined,
      writeOutput: () => undefined,
    });

  assert.equal(await runExecutor(hostedPhase92MigrationCapturePreArgument, false), 1);
  assert.deepEqual(calls, ["repository"]);
  calls.length = 0;
  assert.equal(await runExecutor(hostedPhase92MigrationPreCaptureReadinessArgument, true), 0);
  assert.deepEqual(calls, ["repository", "runtime"]);
});
