import {
  persistHostedImportantBatchBackup,
  persistHostedImportantBatchRebuild,
} from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedPhase91ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

export function persistHostedPhase91Backup(options) {
  return persistHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedPhase91ArtifactContract,
  });
}

export function persistHostedPhase91Rebuild(options) {
  return persistHostedImportantBatchRebuild({
    ...options,
    artifactContract: hostedPhase91ArtifactContract,
  });
}
