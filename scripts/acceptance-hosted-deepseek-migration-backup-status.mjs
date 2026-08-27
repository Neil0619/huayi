import { pathToFileURL } from "node:url";

import {
  inspectHostedImportantBatchEvidence,
  renderHostedImportantBatchStatus,
} from "./acceptance-hosted-important-batch-status.mjs";
import {
  hostedDeepseekMigrationBackupArtifactDirectory,
  readHostedDeepseekMigrationBackupRepositoryState,
  verifyHostedDeepseekMigrationEvidencePhase,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

export const hostedDeepseekMigrationBackupStatusArgument = `--status-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;

export function inspectHostedDeepseekMigrationEvidence(options = {}) {
  const readRepositoryState =
    options.readRepositoryState ?? readHostedDeepseekMigrationBackupRepositoryState;
  return inspectHostedImportantBatchEvidence({
    ...options,
    artifactDirectory: hostedDeepseekMigrationBackupArtifactDirectory,
    readRepositoryState: async (root) => {
      const state = await readRepositoryState(root);
      return {
        ...state,
        worktreeClean: state.worktreeClean === true && state.upstreamExact === true,
      };
    },
    verifyEvidencePhase: options.verifyEvidencePhase ?? verifyHostedDeepseekMigrationEvidencePhase,
  });
}

export async function runHostedDeepseekMigrationBackupStatusCli({
  arguments_ = process.argv.slice(2),
  inspectEvidence = inspectHostedDeepseekMigrationEvidence,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || arguments_[0] !== hostedDeepseekMigrationBackupStatusArgument) {
      throw new Error("Hosted DeepSeek migration backup status arguments are invalid.");
    }
    writeOutput(renderHostedImportantBatchStatus(await inspectEvidence()));
    return 0;
  } catch {
    writeError("Hosted DeepSeek migration backup status failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationBackupStatusCli();
}
