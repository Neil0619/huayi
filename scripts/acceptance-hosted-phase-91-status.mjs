import { pathToFileURL } from "node:url";

import {
  inspectHostedImportantBatchEvidence,
  renderHostedImportantBatchStatus,
} from "./acceptance-hosted-important-batch-status.mjs";
import {
  hostedPhase91BackupArtifactDirectory,
  readHostedPhase91BackupRepositoryState,
  verifyHostedPhase91EvidencePhase,
} from "./acceptance-hosted-phase-91-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

export const hostedPhase91StatusArgument = `--status-0015-public-function-acl-hardening-backup-${hostedAcceptanceProjectRef}`;

export function inspectHostedPhase91Evidence(options = {}) {
  return inspectHostedImportantBatchEvidence({
    ...options,
    artifactDirectory: hostedPhase91BackupArtifactDirectory,
    readRepositoryState: options.readRepositoryState ?? readHostedPhase91BackupRepositoryState,
    verifyEvidencePhase: options.verifyEvidencePhase ?? verifyHostedPhase91EvidencePhase,
  });
}

export async function runHostedPhase91StatusCli({
  arguments_ = process.argv.slice(2),
  inspectEvidence = inspectHostedPhase91Evidence,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || arguments_[0] !== hostedPhase91StatusArgument) {
      throw new Error("Hosted Phase 91 backup status arguments are invalid.");
    }
    writeOutput(renderHostedImportantBatchStatus(await inspectEvidence()));
    return 0;
  } catch {
    writeError("Hosted Phase 91 backup status failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase91StatusCli();
}
