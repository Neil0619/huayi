import { captureHostedImportantBatchBackup } from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedDeepseekMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedDeepseekMigrationBackup } from "./acceptance-hosted-deepseek-migration-artifacts.mjs";

export const hostedDeepseekMigrationCapturePreArgument = `--confirm-capture-pre-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationCapturePostArgument = `--confirm-capture-post-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;

export function captureHostedDeepseekMigrationBackup(options) {
  return captureHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedDeepseekMigrationArtifactContract,
    persistBackup: options.persistBackup ?? persistHostedDeepseekMigrationBackup,
  });
}
