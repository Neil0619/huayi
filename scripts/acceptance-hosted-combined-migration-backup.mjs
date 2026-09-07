import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedCombinedMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
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

import { loadHostedCombinedMigrationSources } from "./acceptance-hosted-combined-migration-sources.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedCombinedMigrationBackupId = hostedCombinedMigrationArtifactContract.batchId;
export const hostedCombinedMigrationBackupArtifactDirectory =
  hostedCombinedMigrationArtifactContract.artifactDirectory;
export const hostedCombinedMigrationBackupPreflightArgument = `--verify-pre-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;
export const hostedCombinedMigrationBackupCompletionArgument = `--verify-post-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;
export const hostedCombinedMigrationBackupHistoricalCompletionArgument = `--verify-historical-completion-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;

export async function readHostedCombinedMigrationBackupRepositoryState(root) {
  await loadHostedCombinedMigrationSources(root);
  return readHostedImportantBatchEvidenceRepositoryState(
    root,
    hostedCombinedMigrationBackupArtifactDirectory,
  );
}

export function readHostedCombinedMigrationBackupHistoricalRepositoryState(
  root,
  historicalCandidateCommit,
) {
  return inspectHostedImportantBatchHistoricalRepository({
    artifactDirectory: hostedCombinedMigrationBackupArtifactDirectory,
    historicalCandidateCommit,
    repositoryRoot: root,
  });
}

export function verifyHostedCombinedMigrationEvidencePhase(options) {
  return verifyHostedImportantBatchEvidencePhase({
    ...options,
    artifactContract: hostedCombinedMigrationArtifactContract,
  });
}

export function renderHostedCombinedMigrationBackupPlan() {
  return `Hosted combined 0026+0027+0028 backup/rebuild plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedCombinedMigrationBackupId}.
Evidence directory: ${hostedCombinedMigrationBackupArtifactDirectory}
- All historical batch evidence stays immutable and is never read as combined evidence.
- The independent pre backup requires migration head 20260905020000.
- The isolated rebuild and post backup require 28 repository migrations through 20260907030000.
- Preflight requires clean pushed exact-candidate pre and rebuild evidence; completion adds post.
- Historical completion verifies immutable pre/rebuild/post evidence against a pushed descendant HEAD.
- This plan performs no filesystem, Git, database, mail, model, deployment, or secret operation.
`;
}

export async function runHostedCombinedMigrationBackupCli({
  arguments_ = process.argv.slice(2),
  evidenceIo = realHostedImportantBatchEvidenceIo,
  readHistoricalRepositoryState = readHostedCombinedMigrationBackupHistoricalRepositoryState,
  readRepositoryState = readHostedCombinedMigrationBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedCombinedMigrationBackupPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  const mode =
    argument === hostedCombinedMigrationBackupPreflightArgument
      ? "preflight"
      : argument === hostedCombinedMigrationBackupCompletionArgument
        ? "completion"
        : argument === hostedCombinedMigrationBackupHistoricalCompletionArgument
          ? "historical-completion"
          : null;
  if (mode === null) {
    writeError("Hosted combined 0026+0027+0028 backup arguments are invalid.\n");
    return 1;
  }
  try {
    if (mode === "historical-completion") {
      await verifyHostedImportantBatchHistoricalEvidence({
        artifactContract: hostedCombinedMigrationArtifactContract,
        evidenceIo,
        readRepositoryState: readHistoricalRepositoryState,
        root,
      });
    } else {
      await verifyHostedImportantBatchEvidence({
        artifactContract: hostedCombinedMigrationArtifactContract,
        evidenceIo,
        mode,
        readRepositoryState,
        root,
      });
    }
    writeOutput(
      mode === "preflight"
        ? "Hosted combined 0026+0027+0028 backup preflight evidence passed.\n"
        : mode === "completion"
          ? "Hosted combined 0026+0027+0028 backup completion evidence passed.\n"
          : "Hosted combined 0026+0027+0028 historical completion evidence passed.\n",
    );
    return 0;
  } catch {
    writeError("Hosted combined 0026+0027+0028 backup evidence verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedCombinedMigrationBackupCli();
}
