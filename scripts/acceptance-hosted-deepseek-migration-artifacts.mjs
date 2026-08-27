import {
  persistHostedImportantBatchBackup,
  persistHostedImportantBatchRebuild,
} from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedDeepseekMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

export function persistHostedDeepseekMigrationBackup(options) {
  return persistHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedDeepseekMigrationArtifactContract,
  });
}

export function persistHostedDeepseekMigrationRebuild(options) {
  return persistHostedImportantBatchRebuild({
    ...options,
    artifactContract: hostedDeepseekMigrationArtifactContract,
  });
}
