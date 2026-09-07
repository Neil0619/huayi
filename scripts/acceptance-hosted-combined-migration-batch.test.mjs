import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hostedPhase92ArtifactContract,
  hostedCombinedMigrationArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  persistHostedCombinedMigrationBackup,
  persistHostedCombinedMigrationRebuild,
} from "./acceptance-hosted-combined-migration-artifacts.mjs";
import {
  hostedCombinedMigrationBackupArtifactDirectory,
  hostedCombinedMigrationBackupCompletionArgument,
  hostedCombinedMigrationBackupHistoricalCompletionArgument,
  hostedCombinedMigrationBackupId,
  hostedCombinedMigrationBackupPreflightArgument,
  renderHostedCombinedMigrationBackupPlan,
  runHostedCombinedMigrationBackupCli,
} from "./acceptance-hosted-combined-migration-backup.mjs";
import {
  hostedCombinedMigrationPostCaptureReadinessArgument,
  hostedCombinedMigrationPreCaptureReadinessArgument,
  hostedCombinedMigrationRebuildReadinessArgument,
  runHostedCombinedMigrationBackupExecutorCli,
} from "./acceptance-hosted-combined-migration-backup-executor.mjs";
import { hostedCombinedMigrationBackupStatusArgument } from "./acceptance-hosted-combined-migration-backup-status.mjs";
import {
  hostedCombinedMigrationCapturePostArgument,
  hostedCombinedMigrationCapturePreArgument,
} from "./acceptance-hosted-combined-migration-capture.mjs";
import {
  hostedCombinedMigrationRebuildArgument,
  loadHostedCombinedMigrationRebuildSources,
} from "./acceptance-hosted-combined-migration-rebuild.mjs";

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
  const root = await mkdtemp(join(tmpdir(), "seen-said-combined-migration-batch-"));
  temporaryRoots.push(root);
  return root;
}

test("Combined 0026+0027+0028 owns a distinct 28-file evidence identity", async () => {
  assert.equal(hostedPhase92ArtifactContract.migrationFiles.length, 22);
  assert.equal(hostedCombinedMigrationArtifactContract.migrationFiles.length, 28);
  assert.equal(hostedCombinedMigrationArtifactContract.preMigrationHead, "20260905020000");
  assert.equal(hostedCombinedMigrationArtifactContract.postMigrationHead, "20260907030000");
  assert.equal(
    hostedCombinedMigrationArtifactContract.migrationFiles.at(-1),
    "20260907030000_password_recovery_correctable_retry.sql",
  );
  assert.notEqual(
    hostedCombinedMigrationArtifactContract.artifactDirectory,
    hostedPhase92ArtifactContract.artifactDirectory,
  );
  const sources = await loadHostedCombinedMigrationRebuildSources(process.cwd());
  assert.equal(sources.migrations.length, 28);
  assert.equal(sources.migrations.at(-1).version, "20260907030000");
  assert.equal(hostedCombinedMigrationBackupId, "combined-hosted-0026-0027-0028-20260907");
  assert.equal(
    hostedCombinedMigrationBackupArtifactDirectory,
    "artifacts/hosted-important-batch-backups/combined-hosted-0026-0027-0028-20260907",
  );
});

test("Combined 0026+0027+0028 evidence closes the exact current and immutable historical batch", async () => {
  const repositoryRoot = await createTemporaryRepository();
  const persistBackup = (phase) =>
    persistHostedCombinedMigrationBackup({
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
  await persistHostedCombinedMigrationRebuild({
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
    const code = await runHostedCombinedMigrationBackupCli({
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

  assert.deepEqual(await runGate(hostedCombinedMigrationBackupPreflightArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted combined 0026+0027+0028 backup preflight evidence passed.\n",
  });
  assert.equal((await runGate(hostedCombinedMigrationBackupCompletionArgument)).code, 1);

  await persistBackup("post");
  assert.deepEqual(await runGate(hostedCombinedMigrationBackupCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted combined 0026+0027+0028 backup completion evidence passed.\n",
  });
  assert.deepEqual(await runGate(hostedCombinedMigrationBackupHistoricalCompletionArgument), {
    code: 0,
    stderr: "",
    stdout: "Hosted combined 0026+0027+0028 historical completion evidence passed.\n",
  });

  historicalRepositoryState.historicalCandidateIsAncestor = false;
  assert.equal((await runGate(hostedCombinedMigrationBackupHistoricalCompletionArgument)).code, 1);
});

test("Combined 0026+0027+0028 plan is zero-operation and package exposes every fixed gate", async () => {
  let calls = 0;
  let output = "";
  assert.equal(
    await runHostedCombinedMigrationBackupCli({
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
  assert.equal(output, renderHostedCombinedMigrationBackupPlan());
  assert.match(output, /28 repository migrations/u);
  assert.match(output, /All historical batch evidence stays immutable/u);

  const scripts = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ).scripts;
  const backup = "node scripts/acceptance-hosted-combined-migration-backup.mjs";
  assert.equal(
    scripts["acceptance:hosted:combined:migration:backup:preflight"],
    `${backup} ${hostedCombinedMigrationBackupPreflightArgument}`,
  );
  assert.equal(
    scripts["acceptance:hosted:combined:migration:backup:complete"],
    `${backup} ${hostedCombinedMigrationBackupCompletionArgument}`,
  );
  assert.equal(
    scripts["acceptance:hosted:combined:migration:backup:historical:verify"],
    `${backup} ${hostedCombinedMigrationBackupHistoricalCompletionArgument}`,
  );
  const executor = "node scripts/acceptance-hosted-combined-migration-backup-executor.mjs";
  for (const [name, argument] of [
    ["executor:pre:readiness", hostedCombinedMigrationPreCaptureReadinessArgument],
    ["executor:rebuild:readiness", hostedCombinedMigrationRebuildReadinessArgument],
    ["executor:post:readiness", hostedCombinedMigrationPostCaptureReadinessArgument],
    ["capture:pre", hostedCombinedMigrationCapturePreArgument],
    ["rebuild", hostedCombinedMigrationRebuildArgument],
    ["capture:post", hostedCombinedMigrationCapturePostArgument],
  ])
    assert.equal(
      scripts[`acceptance:hosted:combined:migration:backup:${name}`],
      `${executor} ${argument}`,
    );
  assert.equal(
    scripts["acceptance:hosted:combined:migration:backup:status"],
    `node scripts/acceptance-hosted-combined-migration-backup-status.mjs ${hostedCombinedMigrationBackupStatusArgument}`,
  );
});

test("Combined 0026+0027+0028 executor fails before secrets when readiness is not exact", async () => {
  const calls = [];
  const code = await runHostedCombinedMigrationBackupExecutorCli({
    arguments_: [hostedCombinedMigrationCapturePreArgument],
    environment: {},
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

test("combined executor accepts only fixed actions and rejects dirty/unpushed candidates before secrets", async () => {
  const runtime = Object.fromEntries(
    [
      "artifactEncryptionReady",
      "dockerDaemonReady",
      "dockerTargetReady",
      "localPlatformImagesReady",
      "pinnedPostgres17RuntimeReady",
      "pinnedScratchRuntimeReady",
      "platformLockReady",
      "supabaseCliPinned",
    ].map((key) => [key, true]),
  );
  for (const scenario of [
    "dirty",
    "unpushed",
    "wrong-argument",
    "environment",
    "capture",
    "rebuild",
    "readiness",
  ]) {
    const calls = [];
    const code = await runHostedCombinedMigrationBackupExecutorCli({
      arguments_: [
        scenario === "wrong-argument"
          ? "--confirm-any-project"
          : scenario === "rebuild"
            ? hostedCombinedMigrationRebuildArgument
            : scenario === "readiness"
              ? hostedCombinedMigrationPreCaptureReadinessArgument
              : hostedCombinedMigrationCapturePreArgument,
      ],
      environment: scenario === "environment" ? { PGPASSWORD: "fictional-never-read" } : {},
      readRepositoryState: async () => {
        calls.push("repository");
        return {
          candidateCommit,
          artifactRootIgnored: true,
          worktreeClean: scenario !== "dirty",
          upstreamExact: scenario !== "unpushed",
        };
      },
      inspectRuntime: async () => {
        calls.push("runtime");
        return runtime;
      },
      readCaptureSecrets: async () => {
        calls.push("secrets");
        return {};
      },
      captureBackup: async (options) => {
        calls.push("capture");
        assert.equal(options.candidateCommit, candidateCommit);
        assert.equal(options.phase, "pre");
      },
      rebuildScratch: async (options) => {
        calls.push("rebuild");
        assert.equal(options.candidateCommit, candidateCommit);
      },
      writeError: () => undefined,
      writeOutput: () => undefined,
    });
    assert.equal(code, ["capture", "rebuild", "readiness"].includes(scenario) ? 0 : 1);
    assert.deepEqual(
      calls,
      scenario === "capture"
        ? ["repository", "runtime", "secrets", "capture"]
        : scenario === "rebuild"
          ? ["repository", "runtime", "rebuild"]
          : scenario === "readiness"
            ? ["repository", "runtime"]
            : ["dirty", "unpushed"].includes(scenario)
              ? ["repository"]
              : [],
    );
  }
});
