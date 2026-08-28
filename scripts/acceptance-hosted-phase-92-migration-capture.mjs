import { captureHostedImportantBatchBackup } from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedPhase92ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedPhase92MigrationBackup } from "./acceptance-hosted-phase-92-migration-artifacts.mjs";

export const hostedPhase92MigrationCapturePreArgument = `--confirm-capture-pre-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase92MigrationCapturePostArgument = `--confirm-capture-post-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;

export function captureHostedPhase92MigrationBackup(options) {
  return captureHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedPhase92ArtifactContract,
    persistBackup: options.persistBackup ?? persistHostedPhase92MigrationBackup,
  });
}
