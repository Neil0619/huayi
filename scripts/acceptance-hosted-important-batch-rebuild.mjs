import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { resolveLocalDockerInspectionTarget } from "./acceptance-local-docker-inspection.mjs";
import { persistHostedImportantBatchRebuild } from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  HostedImportantBatchRebuildStageError,
  normalizeHostedImportantBatchRebuildStageError,
} from "./acceptance-hosted-important-batch-rebuild-diagnostic.mjs";
import {
  hostedImportantBatchPostgresImageReadySql,
  hostedImportantBatchRebuildBaselineSql,
  hostedImportantBatchRebuildMigrationLedgerSql,
  renderHostedImportantBatchRecordedMigration,
  renderHostedImportantBatchRebuildFinalContractSql,
} from "./acceptance-hosted-important-batch-rebuild-sql.mjs";
import { migrateHostedImportantBatchPlatformBaseline } from "./acceptance-hosted-important-batch-platform-baseline.mjs";
import {
  assertFixedLocalDockerTarget,
  hostedImportantBatchMigrationVersions,
  hostedImportantBatchPostgresRuntimeReference,
  hostedImportantBatchScratchContainer,
  inspectHostedImportantBatchContainer,
  isHostedImportantBatchContainerAbsent,
  runHostedImportantBatchProcess,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";

export const hostedImportantBatchRebuildArgument = `--confirm-rebuild-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export { HostedImportantBatchRebuildStageError };

const migrationFiles = Object.freeze([
  "20260821000000_cloud_v1_foundation.sql",
  "20260821010000_account_default_quota.sql",
  "20260821020000_password_auth_callback_method.sql",
  "20260821030000_analysis_reservation_fallback.sql",
  "20260821040000_practice_generation_settlement.sql",
  "20260821050000_owner_scoped_analysis_export.sql",
  "20260821060000_analysis_export_owner_wrapper.sql",
  "20260821070000_extension_pairing_atomic_snapshot.sql",
  "20260821080000_account_deletion_replay.sql",
  "20260822010000_quota_lifecycle_and_model_rate_limit.sql",
  "20260822020000_security_notification_delivery.sql",
  "20260822030000_first_operator_bootstrap.sql",
  "20260823010000_password_signup_interruption_recovery.sql",
  "20260824010000_password_signup_otp_resend.sql",
]);
const seedSha256 = "6defe22d5e21ef4d98f77e2192c1c4c0ad96ec73c964ab897e9a1a63b8003050";

async function assertRegularBoundedFile(path, maximumBytes) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.size < 1 || stats.size > maximumBytes) {
    throw new Error("Hosted important-batch rebuild source is invalid.");
  }
}

export async function loadHostedImportantBatchRebuildSources(repositoryRoot) {
  const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
  const actualFiles = (await readdir(migrationsRoot)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(migrationFiles)) {
    throw new Error("Hosted important-batch migration source set is invalid.");
  }
  const migrations = [];
  for (const [index, file] of migrationFiles.entries()) {
    const path = join(migrationsRoot, file);
    await assertRegularBoundedFile(path, 1_048_576);
    migrations.push({
      source: await readFile(path, "utf8"),
      version: hostedImportantBatchMigrationVersions[index],
    });
  }
  const seedPath = join(repositoryRoot, "supabase", "seed.sql");
  await assertRegularBoundedFile(seedPath, 65_536);
  const seed = await readFile(seedPath, "utf8");
  if (createHash("sha256").update(seed).digest("hex") !== seedSha256) {
    throw new Error("Hosted important-batch fictional seed is invalid.");
  }
  return { migrations, seed };
}

function assertExactSources(sources) {
  if (
    sources === null ||
    typeof sources !== "object" ||
    !Array.isArray(sources.migrations) ||
    sources.migrations.length !== hostedImportantBatchMigrationVersions.length ||
    typeof sources.seed !== "string" ||
    sources.seed.length === 0
  ) {
    throw new Error("Hosted important-batch rebuild sources are invalid.");
  }
  for (const [index, migration] of sources.migrations.entries()) {
    if (
      migration?.version !== hostedImportantBatchMigrationVersions[index] ||
      typeof migration.source !== "string" ||
      migration.source.length === 0
    ) {
      throw new Error("Hosted important-batch rebuild sources are invalid.");
    }
  }
}

function dockerArguments(target, tail) {
  assertFixedLocalDockerTarget(target);
  return ["--host", target.host, ...tail];
}

function psqlExecArguments() {
  return [
    "exec",
    "-i",
    hostedImportantBatchScratchContainer,
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
  ];
}

async function inspectScratch(dockerTarget, runProcess) {
  return inspectHostedImportantBatchContainer(
    dockerTarget,
    hostedImportantBatchScratchContainer,
    runProcess,
  );
}

async function startScratch(dockerTarget, runProcess) {
  const result = await runProcess(
    dockerTarget.command,
    dockerArguments(dockerTarget, [
      "run",
      "--detach",
      "--rm",
      "--pull",
      "never",
      "--name",
      hostedImportantBatchScratchContainer,
      "--label",
      "com.seen-said.acceptance=phase-81-0014-rebuild",
      "--network",
      "none",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--env",
      "POSTGRES_DB=postgres",
      hostedImportantBatchPostgresRuntimeReference,
    ]),
    { maxOutputBytes: 256 },
  );
  return result;
}

function scratchRuntimeIsExact(source) {
  try {
    const inspected = JSON.parse(source);
    return (
      inspected?.Config?.Image === hostedImportantBatchPostgresRuntimeReference &&
      inspected?.Config?.Labels?.["com.seen-said.acceptance"] === "phase-81-0014-rebuild" &&
      inspected?.HostConfig?.NetworkMode === "none" &&
      inspected?.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] ===
        "rw,nosuid,nodev,noexec,size=2147483648,mode=0700" &&
      (inspected?.HostConfig?.Binds === null || inspected?.HostConfig?.Binds?.length === 0) &&
      Array.isArray(inspected?.Mounts) &&
      inspected.Mounts.length === 0
    );
  } catch {
    return false;
  }
}

async function waitForScratch(dockerTarget, runProcess, wait, now) {
  const deadline = now() + 300_000;
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    if (now() >= deadline) break;
    const postmaster = await runProcess(
      dockerTarget.command,
      dockerArguments(dockerTarget, [
        "exec",
        hostedImportantBatchScratchContainer,
        "head",
        "-n",
        "1",
        "/var/lib/postgresql/data/postmaster.pid",
      ]),
      { maxOutputBytes: 16, timeoutMilliseconds: 5_000 },
    );
    if (postmaster.code !== 0 || postmaster.stdout !== "1\n") {
      await wait(250);
      continue;
    }
    if (now() >= deadline) break;
    const ready = await runProcess(
      dockerTarget.command,
      dockerArguments(dockerTarget, [
        "exec",
        hostedImportantBatchScratchContainer,
        "pg_isready",
        "--quiet",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
      ]),
      { maxOutputBytes: 1, timeoutMilliseconds: 5_000 },
    );
    if (ready.code !== 0 || ready.stdout !== "") {
      await wait(250);
      continue;
    }
    if (now() >= deadline) break;
    try {
      await runSql(
        dockerTarget,
        runProcess,
        hostedImportantBatchPostgresImageReadySql,
        "postgres_image_ready|t\n",
        5_000,
      );
      return;
    } catch {
      // The fixed image may still be applying its own initialization after pg_isready succeeds.
    }
    await wait(250);
  }
  throw new Error("Hosted important-batch scratch readiness failed.");
}

async function runSql(
  dockerTarget,
  runProcess,
  input,
  expectedOutput = "",
  timeoutMilliseconds = 1_800_000,
) {
  const result = await runProcess(
    dockerTarget.command,
    dockerArguments(dockerTarget, psqlExecArguments()),
    { input, maxOutputBytes: 4_096, timeoutMilliseconds },
  );
  if (result.code !== 0 || result.stdout !== expectedOutput) {
    throw new Error("Hosted important-batch scratch SQL failed.");
  }
}

async function destroyScratch(dockerTarget, runProcess, wait, waitForLateAppearance) {
  return settleHostedImportantBatchContainer({
    dockerTarget,
    name: hostedImportantBatchScratchContainer,
    runProcess,
    runtimeIsExact: scratchRuntimeIsExact,
    wait,
    waitForLateAppearance,
  });
}

export async function rebuildHostedImportantBatchScratch({
  candidateCommit,
  loadSources = () => loadHostedImportantBatchRebuildSources(repositoryRoot),
  migratePlatformBaseline = migrateHostedImportantBatchPlatformBaseline,
  now = () => performance.now(),
  repositoryRoot,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runProcess = runHostedImportantBatchProcess,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
}) {
  let failureStage = "source-validation";
  try {
    const sources = await loadSources();
    assertExactSources(sources);
    failureStage = "docker-target";
    const dockerTarget = await resolveDockerTarget();
    assertFixedLocalDockerTarget(dockerTarget);
    failureStage = "scratch-identity";
    const existing = await inspectScratch(dockerTarget, runProcess);
    if (!isHostedImportantBatchContainerAbsent(existing)) {
      throw new Error("Hosted important-batch scratch identity is occupied.");
    }
    failureStage = "evidence-persistence";
    await persistHostedImportantBatchRebuild({
      candidateCommit,
      performRebuild: async () => {
        let cleanupRequired = false;
        let operationPassed = false;
        let scratchDestroyed = false;
        let waitForLateAppearance = false;
        try {
          cleanupRequired = true;
          failureStage = "scratch-start";
          let started;
          try {
            started = await startScratch(dockerTarget, runProcess);
          } catch (error) {
            waitForLateAppearance = true;
            throw error;
          }
          waitForLateAppearance = started.code === null;
          if (started.code !== 0) {
            throw new Error("Hosted important-batch scratch start failed.");
          }
          failureStage = "scratch-runtime";
          const inspected = await inspectScratch(dockerTarget, runProcess);
          if (inspected.code !== 0 || !scratchRuntimeIsExact(inspected.stdout)) {
            throw new Error("Hosted important-batch scratch runtime is invalid.");
          }
          failureStage = "scratch-readiness";
          await waitForScratch(dockerTarget, runProcess, wait, now);
          await migratePlatformBaseline({
            dockerTarget,
            onStage: (stage) => {
              if (stage !== "auth-baseline" && stage !== "storage-baseline") {
                throw new Error("Hosted important-batch platform baseline stage is invalid.");
              }
              failureStage = stage;
            },
            runProcess,
            wait,
          });
          failureStage = "baseline";
          await runSql(
            dockerTarget,
            runProcess,
            hostedImportantBatchRebuildBaselineSql,
            "baseline_contract|t\n",
          );
          failureStage = "migration-ledger";
          await runSql(dockerTarget, runProcess, hostedImportantBatchRebuildMigrationLedgerSql);
          failureStage = "migration-application";
          for (const migration of sources.migrations) {
            await runSql(
              dockerTarget,
              runProcess,
              renderHostedImportantBatchRecordedMigration(migration),
            );
          }
          failureStage = "fictional-seed";
          await runSql(dockerTarget, runProcess, sources.seed);
          failureStage = "final-contract";
          await runSql(
            dockerTarget,
            runProcess,
            renderHostedImportantBatchRebuildFinalContractSql(),
            "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
          );
          operationPassed = true;
        } catch {
          operationPassed = false;
        } finally {
          if (cleanupRequired) {
            const operationFailureStage = failureStage;
            failureStage = "scratch-destroy";
            scratchDestroyed = await destroyScratch(
              dockerTarget,
              runProcess,
              wait,
              waitForLateAppearance,
            );
            if (scratchDestroyed) {
              failureStage = operationPassed ? "evidence-persistence" : operationFailureStage;
            }
          }
        }
        if (!operationPassed || !scratchDestroyed) {
          throw new HostedImportantBatchRebuildStageError(failureStage);
        }
        return {
          fictionalSeedExact: true,
          hostedDataAbsent: true,
          migrationChainExact: true,
          runtimeContractExact: true,
          scratchDestroyed: true,
        };
      },
      repositoryRoot,
    });
  } catch (error) {
    throw normalizeHostedImportantBatchRebuildStageError(failureStage, error);
  }
}
