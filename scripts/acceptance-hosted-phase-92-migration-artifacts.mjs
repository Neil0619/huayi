import {
  persistHostedImportantBatchBackup,
  persistHostedImportantBatchRebuild,
} from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedPhase92ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

export function persistHostedPhase92MigrationBackup(options) {
  return persistHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedPhase92ArtifactContract,
  });
}

export function persistHostedPhase92MigrationRebuild(options) {
  return persistHostedImportantBatchRebuild({
    ...options,
    artifactContract: hostedPhase92ArtifactContract,
  });
}
