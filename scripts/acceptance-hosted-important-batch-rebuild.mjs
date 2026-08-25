import { performance } from "node:perf_hooks";

import { resolveLocalDockerInspectionTarget } from "./acceptance-local-docker-inspection.mjs";
import { persistHostedImportantBatchRebuild } from "./acceptance-hosted-important-batch-artifacts.mjs";
import {
  assertHostedImportantBatchArtifactContract,
  hostedPhase81ArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";
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
  assertHostedImportantBatchRebuildSources,
  loadHostedImportantBatchRebuildSources,
} from "./acceptance-hosted-important-batch-rebuild-sources.mjs";
import {
  assertFixedLocalDockerTarget,
  hostedImportantBatchPostgresRuntimeReference,
  inspectHostedImportantBatchContainer,
  isHostedImportantBatchContainerAbsent,
  runHostedImportantBatchProcess,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";

export const hostedImportantBatchRebuildArgument = `--confirm-rebuild-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export { HostedImportantBatchRebuildStageError };
export { loadHostedImportantBatchRebuildSources };

function dockerArguments(target, tail) {
  assertFixedLocalDockerTarget(target);
  return ["--host", target.host, ...tail];
}

function psqlExecArguments(artifactContract) {
  return [
    "exec",
    "-i",
    artifactContract.scratchContainer,
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

async function inspectScratch(artifactContract, dockerTarget, runProcess) {
  return inspectHostedImportantBatchContainer(
    dockerTarget,
    artifactContract.scratchContainer,
    runProcess,
  );
}

async function startScratch(artifactContract, dockerTarget, runProcess) {
  const result = await runProcess(
    dockerTarget.command,
    dockerArguments(dockerTarget, [
      "run",
      "--detach",
      "--rm",
      "--pull",
      "never",
      "--name",
      artifactContract.scratchContainer,
      "--label",
      `com.seen-said.acceptance=${artifactContract.scratchLabel}`,
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

function scratchRuntimeIsExact(source, artifactContract) {
  try {
    const inspected = JSON.parse(source);
    return (
      inspected?.Config?.Image === hostedImportantBatchPostgresRuntimeReference &&
      inspected?.Config?.Labels?.["com.seen-said.acceptance"] === artifactContract.scratchLabel &&
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

async function waitForScratch(artifactContract, dockerTarget, runProcess, wait, now) {
  const deadline = now() + 300_000;
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    if (now() >= deadline) break;
    const postmaster = await runProcess(
      dockerTarget.command,
      dockerArguments(dockerTarget, [
        "exec",
        artifactContract.scratchContainer,
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
        artifactContract.scratchContainer,
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
        artifactContract,
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
  artifactContract,
  dockerTarget,
  runProcess,
  input,
  expectedOutput = "",
  timeoutMilliseconds = 1_800_000,
) {
  const result = await runProcess(
    dockerTarget.command,
    dockerArguments(dockerTarget, psqlExecArguments(artifactContract)),
    { input, maxOutputBytes: 4_096, timeoutMilliseconds },
  );
  if (result.code !== 0 || result.stdout !== expectedOutput) {
    throw new Error("Hosted important-batch scratch SQL failed.");
  }
}

async function destroyScratch(
  artifactContract,
  dockerTarget,
  runProcess,
  wait,
  waitForLateAppearance,
) {
  return settleHostedImportantBatchContainer({
    dockerTarget,
    name: artifactContract.scratchContainer,
    runProcess,
    runtimeIsExact: (source) => scratchRuntimeIsExact(source, artifactContract),
    wait,
    waitForLateAppearance,
  });
}

export async function rebuildHostedImportantBatchScratch({
  artifactContract = hostedPhase81ArtifactContract,
  candidateCommit,
  loadSources = () => loadHostedImportantBatchRebuildSources(repositoryRoot, artifactContract),
  migratePlatformBaseline = migrateHostedImportantBatchPlatformBaseline,
  now = () => performance.now(),
  persistRebuild = persistHostedImportantBatchRebuild,
  repositoryRoot,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runProcess = runHostedImportantBatchProcess,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
}) {
  let failureStage = "source-validation";
  try {
    assertHostedImportantBatchArtifactContract(artifactContract);
    const sources = await loadSources();
    assertHostedImportantBatchRebuildSources(sources, artifactContract);
    failureStage = "docker-target";
    const dockerTarget = await resolveDockerTarget();
    assertFixedLocalDockerTarget(dockerTarget);
    failureStage = "scratch-identity";
    const existing = await inspectScratch(artifactContract, dockerTarget, runProcess);
    if (!isHostedImportantBatchContainerAbsent(existing)) {
      throw new Error("Hosted important-batch scratch identity is occupied.");
    }
    failureStage = "evidence-persistence";
    await persistRebuild({
      artifactContract,
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
            started = await startScratch(artifactContract, dockerTarget, runProcess);
          } catch (error) {
            waitForLateAppearance = true;
            throw error;
          }
          waitForLateAppearance = started.code === null;
          if (started.code !== 0) {
            throw new Error("Hosted important-batch scratch start failed.");
          }
          failureStage = "scratch-runtime";
          const inspected = await inspectScratch(artifactContract, dockerTarget, runProcess);
          if (inspected.code !== 0 || !scratchRuntimeIsExact(inspected.stdout, artifactContract)) {
            throw new Error("Hosted important-batch scratch runtime is invalid.");
          }
          failureStage = "scratch-readiness";
          await waitForScratch(artifactContract, dockerTarget, runProcess, wait, now);
          await migratePlatformBaseline({
            artifactContract,
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
            artifactContract,
            dockerTarget,
            runProcess,
            hostedImportantBatchRebuildBaselineSql,
            "baseline_contract|t\n",
          );
          failureStage = "migration-ledger";
          await runSql(
            artifactContract,
            dockerTarget,
            runProcess,
            hostedImportantBatchRebuildMigrationLedgerSql,
          );
          failureStage = "migration-application";
          for (const migration of sources.migrations) {
            await runSql(
              artifactContract,
              dockerTarget,
              runProcess,
              renderHostedImportantBatchRecordedMigration(migration),
            );
          }
          failureStage = "fictional-seed";
          await runSql(artifactContract, dockerTarget, runProcess, sources.seed);
          failureStage = "final-contract";
          await runSql(
            artifactContract,
            dockerTarget,
            runProcess,
            renderHostedImportantBatchRebuildFinalContractSql(artifactContract.migrationVersions),
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
              artifactContract,
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
