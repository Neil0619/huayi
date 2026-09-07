import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectHostedImportantBatchBackupRuntime } from "./acceptance-hosted-important-batch-backup-executor.mjs";
import {
  readHostedImportantBatchRebuildFailureStage,
  renderHostedImportantBatchRebuildFailure,
} from "./acceptance-hosted-important-batch-rebuild-diagnostic.mjs";
import {
  assessHostedImportantBatchReadiness,
  renderHostedImportantBatchReadinessFailure,
} from "./acceptance-hosted-important-batch-readiness-diagnostic.mjs";
import { readHostedImportantBatchCaptureSecrets } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { rejectLegacyHostedCredentialEnvironment } from "./acceptance-hosted-credentials.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  hostedCombinedMigrationBackupArtifactDirectory,
  hostedCombinedMigrationBackupId,
  readHostedCombinedMigrationBackupRepositoryState,
} from "./acceptance-hosted-combined-migration-backup.mjs";
import {
  captureHostedCombinedMigrationBackup,
  hostedCombinedMigrationCapturePostArgument,
  hostedCombinedMigrationCapturePreArgument,
} from "./acceptance-hosted-combined-migration-capture.mjs";
import {
  hostedCombinedMigrationRebuildArgument,
  rebuildHostedCombinedMigrationScratch,
} from "./acceptance-hosted-combined-migration-rebuild.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedCombinedMigrationPreCaptureReadinessArgument = `--readiness-pre-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;
export const hostedCombinedMigrationRebuildReadinessArgument = `--readiness-rebuild-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;
export const hostedCombinedMigrationPostCaptureReadinessArgument = `--readiness-post-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;

export function renderHostedCombinedMigrationBackupExecutorPlan() {
  return `Hosted combined 0026+0027+0028 backup/rebuild executor plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedCombinedMigrationBackupId}.
Fixed evidence directory: ${hostedCombinedMigrationBackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedCombinedMigrationPreCaptureReadinessArgument}
- isolated rebuild: ${hostedCombinedMigrationRebuildReadinessArgument}
- post capture: ${hostedCombinedMigrationPostCaptureReadinessArgument}
Exact confirmation-gated write operations:
- pre capture: ${hostedCombinedMigrationCapturePreArgument}
- isolated rebuild: ${hostedCombinedMigrationRebuildArgument}
- post capture: ${hostedCombinedMigrationCapturePostArgument}
Execution contract:
- Pre capture requires head 20260905020000; post capture requires 20260907030000.
- The networkless scratch applies exactly 28 repository migrations through 20260907030000, verifies contracts, destroys scratch, and only then writes a manifest.
- Readiness proves clean pushed source, clone-local ignore, pinned runtime, FileVault, fixed Docker target, platform lock, and local digest identities without pulling, connecting to Hosted, or writing evidence.
- All historical batch evidence remains immutable and is never accepted as combined evidence.
Current result: this plan reports only the reviewed fixed contract and performs no operation.
`;
}

export async function runHostedCombinedMigrationBackupExecutorCli({
  arguments_ = process.argv.slice(2),
  captureBackup = captureHostedCombinedMigrationBackup,
  environment = process.env,
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readCaptureSecrets = readHostedImportantBatchCaptureSecrets,
  readRepositoryState = readHostedCombinedMigrationBackupRepositoryState,
  rebuildScratch = rebuildHostedCombinedMigrationScratch,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedCombinedMigrationBackupExecutorPlan());
    return 0;
  }
  const operation = new Map([
    [hostedCombinedMigrationPreCaptureReadinessArgument, { kind: "readiness", phase: "pre" }],
    [hostedCombinedMigrationRebuildReadinessArgument, { kind: "readiness", phase: "rebuild" }],
    [hostedCombinedMigrationPostCaptureReadinessArgument, { kind: "readiness", phase: "post" }],
    [hostedCombinedMigrationCapturePreArgument, { kind: "capture", phase: "pre" }],
    [hostedCombinedMigrationRebuildArgument, { kind: "rebuild", phase: "rebuild" }],
    [hostedCombinedMigrationCapturePostArgument, { kind: "capture", phase: "post" }],
  ]).get(arguments_.length === 1 ? arguments_[0] : null);
  if (operation === undefined) {
    writeError("Hosted combined 0026+0027+0028 backup executor arguments are invalid.\n");
    return 1;
  }
  if (operation.kind === "capture") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
    } catch {
      writeError("Hosted combined 0026+0027+0028 backup executor operation failed closed.\n");
      return 1;
    }
  }
  const readiness = await assessHostedImportantBatchReadiness({
    inspectRuntime,
    readRepositoryState: async (repository) => {
      const state = await readRepositoryState(repository);
      return {
        ...state,
        worktreeClean: state.worktreeClean === true && state.upstreamExact === true,
      };
    },
    repositoryRoot: root,
  });
  if (!readiness.ready) {
    writeError(
      operation.kind === "readiness"
        ? renderHostedImportantBatchReadinessFailure(readiness.failedStage ?? "runtime-inspection")
        : "Hosted combined 0026+0027+0028 backup executor operation failed closed.\n",
    );
    return 1;
  }
  try {
    if (operation.kind === "readiness") {
      writeOutput(`Hosted combined 0026+0027+0028 ${operation.phase} readiness passed.\n`);
      return 0;
    }
    if (operation.kind === "capture") {
      const secrets = await readCaptureSecrets({ environment });
      await captureBackup({
        ...secrets,
        candidateCommit: readiness.candidateCommit,
        phase: operation.phase,
        repositoryRoot: root,
      });
      writeOutput(`Hosted combined 0026+0027+0028 ${operation.phase} backup captured.\n`);
      return 0;
    }
    await rebuildScratch({ candidateCommit: readiness.candidateCommit, repositoryRoot: root });
    writeOutput("Hosted combined 0026+0027+0028 isolated rebuild verified and destroyed.\n");
    return 0;
  } catch (error) {
    const stage =
      operation.kind === "rebuild" ? readHostedImportantBatchRebuildFailureStage(error) : null;
    writeError(
      stage === null
        ? "Hosted combined 0026+0027+0028 backup executor operation failed closed.\n"
        : renderHostedImportantBatchRebuildFailure(stage),
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedCombinedMigrationBackupExecutorCli();
}
