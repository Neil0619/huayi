import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  loadHostedImportantBatchRebuildSources,
  rebuildHostedImportantBatchScratch,
} from "./acceptance-hosted-important-batch-rebuild.mjs";
import { hostedPhase91ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { persistHostedPhase91Rebuild } from "./acceptance-hosted-phase-91-artifacts.mjs";

export const hostedPhase91RebuildArgument = `--confirm-rebuild-0015-public-function-acl-hardening-${hostedAcceptanceProjectRef}`;

export function loadHostedPhase91RebuildSources(repositoryRoot) {
  return loadHostedImportantBatchRebuildSources(repositoryRoot, hostedPhase91ArtifactContract);
}

export function rebuildHostedPhase91Scratch(options) {
  return rebuildHostedImportantBatchScratch({
    ...options,
    artifactContract: hostedPhase91ArtifactContract,
    loadSources:
      options.loadSources ?? (() => loadHostedPhase91RebuildSources(options.repositoryRoot)),
    persistRebuild: options.persistRebuild ?? persistHostedPhase91Rebuild,
  });
}
