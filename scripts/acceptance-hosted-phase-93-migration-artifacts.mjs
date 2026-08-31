import {
  persistHostedImportantBatchBackup,
  persistHostedImportantBatchRebuild,
} from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedPhase93ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

export function persistHostedPhase93MigrationBackup(options) {
  return persistHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedPhase93ArtifactContract,
  });
}

export function persistHostedPhase93MigrationRebuild(options) {
  return persistHostedImportantBatchRebuild({
    ...options,
    artifactContract: hostedPhase93ArtifactContract,
  });
}
