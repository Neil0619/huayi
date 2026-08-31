import { captureHostedImportantBatchBackup } from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedPhase93ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedPhase93MigrationBackup } from "./acceptance-hosted-phase-93-migration-artifacts.mjs";

export const hostedPhase93MigrationCapturePreArgument = `--confirm-capture-pre-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase93MigrationCapturePostArgument = `--confirm-capture-post-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;

export function captureHostedPhase93MigrationBackup(options) {
  return captureHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedPhase93ArtifactContract,
    persistBackup: options.persistBackup ?? persistHostedPhase93MigrationBackup,
  });
}
