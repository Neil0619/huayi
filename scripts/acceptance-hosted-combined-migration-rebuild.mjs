import { hostedCombinedMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { runHostedImportantBatchProcess } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { renderHostedImportantBatchRebuildFinalContractSql } from "./acceptance-hosted-important-batch-rebuild-sql.mjs";
import { rebuildHostedImportantBatchScratch } from "./acceptance-hosted-important-batch-rebuild.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedCombinedMigrationRebuild } from "./acceptance-hosted-combined-migration-artifacts.mjs";
import {
  assertHostedCombinedMigrationSources,
  loadHostedCombinedMigrationSources,
} from "./acceptance-hosted-combined-migration-sources.mjs";
import { hostedCombinedMigrationRebuildExtraSql } from "./acceptance-hosted-combined-migration-sql.mjs";

export const hostedCombinedMigrationRebuildArgument = `--confirm-rebuild-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;
export const loadHostedCombinedMigrationRebuildSources = loadHostedCombinedMigrationSources;

export function rebuildHostedCombinedMigrationScratch(options) {
  const runProcess = options.runProcess ?? runHostedImportantBatchProcess;
  const finalSql = renderHostedImportantBatchRebuildFinalContractSql(
    hostedCombinedMigrationArtifactContract.migrationVersions,
  );
  const persistRebuild = options.persistRebuild ?? persistHostedCombinedMigrationRebuild;
  let extraContractChecked = false;
  return rebuildHostedImportantBatchScratch({
    ...options,
    artifactContract: hostedCombinedMigrationArtifactContract,
    loadSources: async () => {
      const sources = await (
        options.loadSources ?? (() => loadHostedCombinedMigrationSources(options.repositoryRoot))
      )();
      assertHostedCombinedMigrationSources(sources);
      return sources;
    },
    runProcess: async (command, arguments_, processOptions = {}) => {
      if (processOptions.input !== finalSql) return runProcess(command, arguments_, processOptions);
      if (extraContractChecked) throw new Error("Combined rebuild contract already checked.");
      const extra = await runProcess(command, arguments_, {
        ...processOptions,
        input: hostedCombinedMigrationRebuildExtraSql,
      });
      if (extra.code !== 0 || extra.stdout !== "")
        throw new Error("Combined rebuild contract failed.");
      extraContractChecked = true;
      return runProcess(command, arguments_, processOptions);
    },
    persistRebuild: (persistOptions) =>
      persistRebuild({
        ...persistOptions,
        performRebuild: async () => {
          const verdict = await persistOptions.performRebuild();
          if (!extraContractChecked) throw new Error("Combined rebuild contract was not checked.");
          return verdict;
        },
      }),
  });
}
