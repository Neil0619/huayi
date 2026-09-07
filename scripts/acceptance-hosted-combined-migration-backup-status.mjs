import { pathToFileURL } from "node:url";

import {
  inspectHostedImportantBatchEvidence,
  renderHostedImportantBatchStatus,
} from "./acceptance-hosted-important-batch-status.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  hostedCombinedMigrationBackupArtifactDirectory,
  readHostedCombinedMigrationBackupRepositoryState,
  verifyHostedCombinedMigrationEvidencePhase,
} from "./acceptance-hosted-combined-migration-backup.mjs";

export const hostedCombinedMigrationBackupStatusArgument = `--status-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;

export function inspectHostedCombinedMigrationEvidence(options = {}) {
  const readRepositoryState =
    options.readRepositoryState ?? readHostedCombinedMigrationBackupRepositoryState;
  return inspectHostedImportantBatchEvidence({
    ...options,
    artifactDirectory: hostedCombinedMigrationBackupArtifactDirectory,
    readRepositoryState: async (root) => {
      const state = await readRepositoryState(root);
      return {
        ...state,
        worktreeClean: state.worktreeClean === true && state.upstreamExact === true,
      };
    },
    verifyEvidencePhase: options.verifyEvidencePhase ?? verifyHostedCombinedMigrationEvidencePhase,
  });
}

export async function runHostedCombinedMigrationBackupStatusCli({
  arguments_ = process.argv.slice(2),
  inspectEvidence = inspectHostedCombinedMigrationEvidence,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || arguments_[0] !== hostedCombinedMigrationBackupStatusArgument) {
      throw new Error("invalid arguments");
    }
    writeOutput(renderHostedImportantBatchStatus(await inspectEvidence()));
    return 0;
  } catch {
    writeError("Hosted combined 0026+0027+0028 backup status failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedCombinedMigrationBackupStatusCli();
}
