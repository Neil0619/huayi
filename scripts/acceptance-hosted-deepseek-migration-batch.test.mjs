import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hostedDeepseekMigrationArtifactContract,
  hostedPhase91ArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  hostedDeepseekMigrationBackupArtifactDirectory,
  hostedDeepseekMigrationBackupCompletionArgument,
  hostedDeepseekMigrationBackupId,
  hostedDeepseekMigrationBackupPreflightArgument,
  renderHostedDeepseekMigrationBackupPlan,
  runHostedDeepseekMigrationBackupCli,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import {
  hostedDeepseekMigrationRebuildArgument,
  loadHostedDeepseekMigrationRebuildSources,
} from "./acceptance-hosted-deepseek-migration-rebuild.mjs";
import {
  persistHostedDeepseekMigrationBackup,
  persistHostedDeepseekMigrationRebuild,
} from "./acceptance-hosted-deepseek-migration-artifacts.mjs";
import { hostedDeepseekMigrationCapturePreArgument } from "./acceptance-hosted-deepseek-migration-capture.mjs";
import {
  hostedDeepseekMigrationPreCaptureReadinessArgument,
  runHostedDeepseekMigrationBackupExecutorCli,
} from "./acceptance-hosted-deepseek-migration-backup-executor.mjs";

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
  const root = await mkdtemp(join(tmpdir(), "seen-said-deepseek-migration-batch-"));
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

test("DeepSeek migration batch pins a new 21-file identity without changing Phase 91", async () => {
  assert.equal(hostedPhase91ArtifactContract.migrationFiles.length, 15);
  assert.equal(hostedPhase91ArtifactContract.rebuildMigrationHead, "20260825010000");
  assert.equal(hostedDeepseekMigrationArtifactContract.migrationFiles.length, 21);
  assert.equal(
    hostedDeepseekMigrationArtifactContract.migrationFiles.at(-1),
    "20260827060000_hosted_deepseek_acceptance_evidence.sql",
  );
  assert.equal(hostedDeepseekMigrationArtifactContract.preMigrationHead, "20260825010000");
  assert.equal(hostedDeepseekMigrationArtifactContract.rebuildMigrationHead, "20260827060000");
  assert.notEqual(
    hostedDeepseekMigrationArtifactContract.artifactDirectory,
    hostedPhase91ArtifactContract.artifactDirectory,
  );

  const sources = await loadHostedDeepseekMigrationRebuildSources(process.cwd());
  assert.equal(sources.migrations.length, 21);
  assert.equal(sources.migrations.at(-1).version, "20260827060000");
  assert.match(hostedDeepseekMigrationRebuildArgument, /0016-0021/u);
});

test("DeepSeek migration backup plan is zero-I/O and exposes only fixed commands", async () => {
  let calls = 0;
  let stdout = "";
  const code = await runHostedDeepseekMigrationBackupCli({
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
  assert.equal(stdout, renderHostedDeepseekMigrationBackupPlan());
  assert.match(stdout, /21 repository migrations/u);
  assert.match(stdout, /20260825010000/u);
  assert.match(stdout, /20260827060000/u);
  assert.match(stdout, /Phase 91.+immutable/isu);

  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:migration:backup:plan"],
    "node scripts/acceptance-hosted-deepseek-migration-backup.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:migration:backup:preflight"],
    `node scripts/acceptance-hosted-deepseek-migration-backup.mjs ${hostedDeepseekMigrationBackupPreflightArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:migration:backup:complete"],
    `node scripts/acceptance-hosted-deepseek-migration-backup.mjs ${hostedDeepseekMigrationBackupCompletionArgument}`,
  );
  assert.equal(hostedDeepseekMigrationBackupId, "hosted-deepseek-0016-0021");
  assert.equal(
    hostedDeepseekMigrationBackupArtifactDirectory,
    "artifacts/hosted-important-batch-backups/hosted-deepseek-0016-0021",
  );
});

test("DeepSeek migration backup rejects every non-plan argument before I/O", async () => {
  for (const arguments_ of [
    [],
    [hostedDeepseekMigrationBackupPreflightArgument, "extra"],
    ["--verify-pre-0015-public-function-acl-hardening"],
  ]) {
    let reads = 0;
    let stderr = "";
    const code = await runHostedDeepseekMigrationBackupCli({
      arguments_,
      readRepositoryState: async () => {
        reads += 1;
      },
      writeError: (value) => {
        stderr += value;
      },
    });
    assert.equal(code, 1);
    assert.equal(reads, 0);
    assert.equal(stderr, "Hosted DeepSeek migration backup arguments are invalid.\n");
  }
});

test("DeepSeek migration evidence closes only an exact current pre/rebuild/post batch", async () => {
  const repositoryRoot = await createTemporaryRepository();
  const persistBackup = (phase) =>
    persistHostedDeepseekMigrationBackup({
      ...portableFilesystemOptions,
      candidateCommit,
      now: () => new Date("2026-08-27T08:00:00.000Z"),
      phase,
      produceArchive: ({ archivePartialPath }) =>
        writeFile(archivePartialPath, `opaque-${phase}-database-dump`),
      repositoryRoot,
      verifyArchive: async () => undefined,
    });
  await persistBackup("pre");
  await persistHostedDeepseekMigrationRebuild({
    ...portableFilesystemOptions,
    candidateCommit,
    now: () => new Date("2026-08-27T08:01:00.000Z"),
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
  const runEvidenceGate = async (argument) => {
    let stderr = "";
    let stdout = "";
    const code = await runHostedDeepseekMigrationBackupCli({
      arguments_: [argument],
      evidenceIo: portableEvidenceIo,
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

  assert.deepEqual(await runEvidenceGate(hostedDeepseekMigrationBackupPreflightArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted DeepSeek migration backup preflight evidence passed.\n",
  });
  assert.equal((await runEvidenceGate(hostedDeepseekMigrationBackupCompletionArgument)).code, 1);

  await persistBackup("post");
  assert.deepEqual(await runEvidenceGate(hostedDeepseekMigrationBackupCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted DeepSeek migration backup completion evidence passed.\n",
  });

  const manifestPath = join(
    repositoryRoot,
    hostedDeepseekMigrationBackupArtifactDirectory,
    "rebuild",
    "rebuild-verification.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.batchId = "phase-91-0015-public-function-acl-hardening";
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  assert.equal((await runEvidenceGate(hostedDeepseekMigrationBackupPreflightArgument)).code, 1);
});

test("DeepSeek migration executor requires pushed readiness before secrets or writes", async () => {
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
    runHostedDeepseekMigrationBackupExecutorCli({
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

  assert.equal(await runExecutor(hostedDeepseekMigrationCapturePreArgument, false), 1);
  assert.deepEqual(calls, ["repository"]);
  calls.length = 0;
  assert.equal(await runExecutor(hostedDeepseekMigrationPreCaptureReadinessArgument, true), 0);
  assert.deepEqual(calls, ["repository", "runtime"]);
});
