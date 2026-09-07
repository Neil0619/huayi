import {
  persistHostedImportantBatchBackup,
  persistHostedImportantBatchRebuild,
} from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedCombinedMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

export function persistHostedCombinedMigrationBackup(options) {
  return persistHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedCombinedMigrationArtifactContract,
  });
}

export function persistHostedCombinedMigrationRebuild(options) {
  return persistHostedImportantBatchRebuild({
    ...options,
    artifactContract: hostedCombinedMigrationArtifactContract,
  });
}
