import { pathToFileURL } from "node:url";

import {
  inspectHostedImportantBatchEvidence,
  renderHostedImportantBatchStatus,
} from "./acceptance-hosted-important-batch-status.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  hostedPhase92MigrationBackupArtifactDirectory,
  readHostedPhase92MigrationBackupRepositoryState,
  verifyHostedPhase92MigrationEvidencePhase,
} from "./acceptance-hosted-phase-92-migration-backup.mjs";

export const hostedPhase92MigrationBackupStatusArgument = `--status-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;

export function inspectHostedPhase92MigrationEvidence(options = {}) {
  const readRepositoryState =
    options.readRepositoryState ?? readHostedPhase92MigrationBackupRepositoryState;
  return inspectHostedImportantBatchEvidence({
    ...options,
    artifactDirectory: hostedPhase92MigrationBackupArtifactDirectory,
    readRepositoryState: async (root) => {
      const state = await readRepositoryState(root);
      return {
        ...state,
        worktreeClean: state.worktreeClean === true && state.upstreamExact === true,
      };
    },
    verifyEvidencePhase: options.verifyEvidencePhase ?? verifyHostedPhase92MigrationEvidencePhase,
  });
}

export async function runHostedPhase92MigrationBackupStatusCli({
  arguments_ = process.argv.slice(2),
  inspectEvidence = inspectHostedPhase92MigrationEvidence,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || arguments_[0] !== hostedPhase92MigrationBackupStatusArgument) {
      throw new Error("Hosted Phase 92 migration backup status arguments are invalid.");
    }
    writeOutput(renderHostedImportantBatchStatus(await inspectEvidence()));
    return 0;
  } catch {
    writeError("Hosted Phase 92 migration backup status failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase92MigrationBackupStatusCli();
}
