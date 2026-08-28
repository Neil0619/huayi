import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedPhase92ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  readHostedImportantBatchEvidenceRepositoryState,
  realHostedImportantBatchEvidenceIo,
  verifyHostedImportantBatchEvidence,
  verifyHostedImportantBatchEvidencePhase,
} from "./acceptance-hosted-important-batch-evidence.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedPhase92MigrationBackupId = hostedPhase92ArtifactContract.batchId;
export const hostedPhase92MigrationBackupArtifactDirectory =
  hostedPhase92ArtifactContract.artifactDirectory;
export const hostedPhase92MigrationBackupPreflightArgument = `--verify-pre-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase92MigrationBackupCompletionArgument = `--verify-post-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;

export function readHostedPhase92MigrationBackupRepositoryState(root) {
  return readHostedImportantBatchEvidenceRepositoryState(
    root,
    hostedPhase92MigrationBackupArtifactDirectory,
  );
}

export function verifyHostedPhase92MigrationEvidencePhase(options) {
  return verifyHostedImportantBatchEvidencePhase({
    ...options,
    artifactContract: hostedPhase92ArtifactContract,
  });
}

export function renderHostedPhase92MigrationBackupPlan() {
  return `Hosted Phase 92 migration 0022 backup/rebuild plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedPhase92MigrationBackupId}.
Evidence directory: ${hostedPhase92MigrationBackupArtifactDirectory}
- DeepSeek 0016-0021 evidence stays immutable and is never read as Phase 92 evidence.
- The independent pre backup requires migration head 20260827060000.
- The isolated rebuild and post backup require 22 repository migrations through 20260828010000.
- Preflight requires clean pushed exact-candidate pre and rebuild evidence; completion adds post.
- This plan performs no filesystem, Git, database, mail, model, deployment, or secret operation.
`;
}

export async function runHostedPhase92MigrationBackupCli({
  arguments_ = process.argv.slice(2),
  evidenceIo = realHostedImportantBatchEvidenceIo,
  readRepositoryState = readHostedPhase92MigrationBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase92MigrationBackupPlan());
    return 0;
  }
  const mode =
    arguments_.length === 1 && arguments_[0] === hostedPhase92MigrationBackupPreflightArgument
      ? "preflight"
      : arguments_.length === 1 && arguments_[0] === hostedPhase92MigrationBackupCompletionArgument
        ? "completion"
        : null;
  if (mode === null) {
    writeError("Hosted Phase 92 migration backup arguments are invalid.\n");
    return 1;
  }
  try {
    await verifyHostedImportantBatchEvidence({
      artifactContract: hostedPhase92ArtifactContract,
      evidenceIo,
      mode,
      readRepositoryState,
      root,
    });
    writeOutput(
      mode === "preflight"
        ? "Hosted Phase 92 migration backup preflight evidence passed.\n"
        : "Hosted Phase 92 migration backup completion evidence passed.\n",
    );
    return 0;
  } catch {
    writeError("Hosted Phase 92 migration backup evidence verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase92MigrationBackupCli();
}
