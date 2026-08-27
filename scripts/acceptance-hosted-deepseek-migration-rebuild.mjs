import { hostedDeepseekMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { loadHostedImportantBatchRebuildSources } from "./acceptance-hosted-important-batch-rebuild-sources.mjs";
import { rebuildHostedImportantBatchScratch } from "./acceptance-hosted-important-batch-rebuild.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedDeepseekMigrationRebuild } from "./acceptance-hosted-deepseek-migration-artifacts.mjs";

export const hostedDeepseekMigrationRebuildArgument = `--confirm-rebuild-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;

export function loadHostedDeepseekMigrationRebuildSources(repositoryRoot) {
  return loadHostedImportantBatchRebuildSources(
    repositoryRoot,
    hostedDeepseekMigrationArtifactContract,
  );
}

export function rebuildHostedDeepseekMigrationScratch(options) {
  return rebuildHostedImportantBatchScratch({
    ...options,
    artifactContract: hostedDeepseekMigrationArtifactContract,
    loadSources:
      options.loadSources ??
      (() => loadHostedDeepseekMigrationRebuildSources(options.repositoryRoot)),
    persistRebuild: options.persistRebuild ?? persistHostedDeepseekMigrationRebuild,
  });
}
