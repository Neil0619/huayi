import { hostedPhase93ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { loadHostedImportantBatchRebuildSources } from "./acceptance-hosted-important-batch-rebuild-sources.mjs";
import { rebuildHostedImportantBatchScratch } from "./acceptance-hosted-important-batch-rebuild.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedPhase93MigrationRebuild } from "./acceptance-hosted-phase-93-migration-artifacts.mjs";

export const hostedPhase93MigrationRebuildArgument = `--confirm-rebuild-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;

export function loadHostedPhase93MigrationRebuildSources(repositoryRoot) {
  return loadHostedImportantBatchRebuildSources(repositoryRoot, hostedPhase93ArtifactContract);
}

export function rebuildHostedPhase93MigrationScratch(options) {
  return rebuildHostedImportantBatchScratch({
    ...options,
    artifactContract: hostedPhase93ArtifactContract,
    loadSources:
      options.loadSources ??
      (() => loadHostedPhase93MigrationRebuildSources(options.repositoryRoot)),
    persistRebuild: options.persistRebuild ?? persistHostedPhase93MigrationRebuild,
  });
}
