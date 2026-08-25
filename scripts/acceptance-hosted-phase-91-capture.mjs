import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { captureHostedImportantBatchBackup } from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedPhase91ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { persistHostedPhase91Backup } from "./acceptance-hosted-phase-91-artifacts.mjs";

export const hostedPhase91CapturePreArgument = `--confirm-capture-pre-0015-public-function-acl-hardening-${hostedAcceptanceProjectRef}`;
export const hostedPhase91CapturePostArgument = `--confirm-capture-post-0015-public-function-acl-hardening-${hostedAcceptanceProjectRef}`;

export function captureHostedPhase91Backup(options) {
  return captureHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedPhase91ArtifactContract,
    persistBackup: persistHostedPhase91Backup,
  });
}
