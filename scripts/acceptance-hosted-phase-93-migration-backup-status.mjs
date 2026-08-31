import { pathToFileURL } from "node:url";

import {
  inspectHostedImportantBatchEvidence,
  renderHostedImportantBatchStatus,
} from "./acceptance-hosted-important-batch-status.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  hostedPhase93MigrationBackupArtifactDirectory,
  readHostedPhase93MigrationBackupRepositoryState,
  verifyHostedPhase93MigrationEvidencePhase,
} from "./acceptance-hosted-phase-93-migration-backup.mjs";

export const hostedPhase93MigrationBackupStatusArgument = `--status-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;

export function inspectHostedPhase93MigrationEvidence(options = {}) {
  const readRepositoryState =
    options.readRepositoryState ?? readHostedPhase93MigrationBackupRepositoryState;
  return inspectHostedImportantBatchEvidence({
    ...options,
    artifactDirectory: hostedPhase93MigrationBackupArtifactDirectory,
    readRepositoryState: async (root) => {
      const state = await readRepositoryState(root);
      return {
        ...state,
        worktreeClean: state.worktreeClean === true && state.upstreamExact === true,
      };
    },
    verifyEvidencePhase: options.verifyEvidencePhase ?? verifyHostedPhase93MigrationEvidencePhase,
  });
}

export async function runHostedPhase93MigrationBackupStatusCli({
  arguments_ = process.argv.slice(2),
  inspectEvidence = inspectHostedPhase93MigrationEvidence,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || arguments_[0] !== hostedPhase93MigrationBackupStatusArgument) {
      throw new Error("invalid arguments");
    }
    writeOutput(renderHostedImportantBatchStatus(await inspectEvidence()));
    return 0;
  } catch {
    writeError("Hosted Phase 93 migration backup status failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase93MigrationBackupStatusCli();
}
