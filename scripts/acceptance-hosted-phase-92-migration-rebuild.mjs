import { hostedPhase92ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { loadHostedImportantBatchRebuildSources } from "./acceptance-hosted-important-batch-rebuild-sources.mjs";
import { rebuildHostedImportantBatchScratch } from "./acceptance-hosted-important-batch-rebuild.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedPhase92MigrationRebuild } from "./acceptance-hosted-phase-92-migration-artifacts.mjs";

export const hostedPhase92MigrationRebuildArgument = `--confirm-rebuild-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;

export function loadHostedPhase92MigrationRebuildSources(repositoryRoot) {
  return loadHostedImportantBatchRebuildSources(repositoryRoot, hostedPhase92ArtifactContract);
}

export function rebuildHostedPhase92MigrationScratch(options) {
  return rebuildHostedImportantBatchScratch({
    ...options,
    artifactContract: hostedPhase92ArtifactContract,
    loadSources:
      options.loadSources ??
      (() => loadHostedPhase92MigrationRebuildSources(options.repositoryRoot)),
    persistRebuild: options.persistRebuild ?? persistHostedPhase92MigrationRebuild,
  });
}
