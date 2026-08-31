import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedPhase93ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  readHostedImportantBatchEvidenceRepositoryState,
  realHostedImportantBatchEvidenceIo,
  verifyHostedImportantBatchEvidence,
  verifyHostedImportantBatchEvidencePhase,
} from "./acceptance-hosted-important-batch-evidence.mjs";
import {
  inspectHostedImportantBatchHistoricalRepository,
  verifyHostedImportantBatchHistoricalEvidence,
} from "./acceptance-hosted-important-batch-historical-evidence.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedPhase93MigrationBackupId = hostedPhase93ArtifactContract.batchId;
export const hostedPhase93MigrationBackupArtifactDirectory =
  hostedPhase93ArtifactContract.artifactDirectory;
export const hostedPhase93MigrationBackupPreflightArgument = `--verify-pre-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase93MigrationBackupCompletionArgument = `--verify-post-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase93MigrationBackupHistoricalCompletionArgument = `--verify-historical-completion-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;

export function readHostedPhase93MigrationBackupRepositoryState(root) {
  return readHostedImportantBatchEvidenceRepositoryState(
    root,
    hostedPhase93MigrationBackupArtifactDirectory,
  );
}

export function readHostedPhase93MigrationBackupHistoricalRepositoryState(
  root,
  historicalCandidateCommit,
) {
  return inspectHostedImportantBatchHistoricalRepository({
    artifactDirectory: hostedPhase93MigrationBackupArtifactDirectory,
    historicalCandidateCommit,
    repositoryRoot: root,
  });
}

export function verifyHostedPhase93MigrationEvidencePhase(options) {
  return verifyHostedImportantBatchEvidencePhase({
    ...options,
    artifactContract: hostedPhase93ArtifactContract,
  });
}

export function renderHostedPhase93MigrationBackupPlan() {
  return `Hosted Phase 93 migration 0023 backup/rebuild plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedPhase93MigrationBackupId}.
Evidence directory: ${hostedPhase93MigrationBackupArtifactDirectory}
- Phase 92 0022 evidence stays immutable and is never read as Phase 93 evidence.
- The independent pre backup requires migration head 20260828010000.
- The isolated rebuild and post backup require 23 repository migrations through 20260831010000.
- Preflight requires clean pushed exact-candidate pre and rebuild evidence; completion adds post.
- Historical completion verifies immutable pre/rebuild/post evidence against a pushed descendant HEAD.
- This plan performs no filesystem, Git, database, mail, model, deployment, or secret operation.
`;
}

export async function runHostedPhase93MigrationBackupCli({
  arguments_ = process.argv.slice(2),
  evidenceIo = realHostedImportantBatchEvidenceIo,
  readHistoricalRepositoryState = readHostedPhase93MigrationBackupHistoricalRepositoryState,
  readRepositoryState = readHostedPhase93MigrationBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase93MigrationBackupPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  const mode =
    argument === hostedPhase93MigrationBackupPreflightArgument
      ? "preflight"
      : argument === hostedPhase93MigrationBackupCompletionArgument
        ? "completion"
        : argument === hostedPhase93MigrationBackupHistoricalCompletionArgument
          ? "historical-completion"
          : null;
  if (mode === null) {
    writeError("Hosted Phase 93 migration backup arguments are invalid.\n");
    return 1;
  }
  try {
    if (mode === "historical-completion") {
      await verifyHostedImportantBatchHistoricalEvidence({
        artifactContract: hostedPhase93ArtifactContract,
        evidenceIo,
        readRepositoryState: readHistoricalRepositoryState,
        root,
      });
    } else {
      await verifyHostedImportantBatchEvidence({
        artifactContract: hostedPhase93ArtifactContract,
        evidenceIo,
        mode,
        readRepositoryState,
        root,
      });
    }
    writeOutput(
      mode === "preflight"
        ? "Hosted Phase 93 migration backup preflight evidence passed.\n"
        : mode === "completion"
          ? "Hosted Phase 93 migration backup completion evidence passed.\n"
          : "Hosted Phase 93 migration historical completion evidence passed.\n",
    );
    return 0;
  } catch {
    writeError("Hosted Phase 93 migration backup evidence verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase93MigrationBackupCli();
}
