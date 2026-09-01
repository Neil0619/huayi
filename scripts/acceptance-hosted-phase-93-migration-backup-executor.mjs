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
  hostedPhase93MigrationBackupArtifactDirectory,
  hostedPhase93MigrationBackupId,
  readHostedPhase93MigrationBackupRepositoryState,
} from "./acceptance-hosted-phase-93-migration-backup.mjs";
import {
  captureHostedPhase93MigrationBackup,
  hostedPhase93MigrationCapturePostArgument,
  hostedPhase93MigrationCapturePreArgument,
} from "./acceptance-hosted-phase-93-migration-capture.mjs";
import {
  hostedPhase93MigrationRebuildArgument,
  rebuildHostedPhase93MigrationScratch,
} from "./acceptance-hosted-phase-93-migration-rebuild.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedPhase93MigrationPreCaptureReadinessArgument = `--readiness-pre-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase93MigrationRebuildReadinessArgument = `--readiness-rebuild-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase93MigrationPostCaptureReadinessArgument = `--readiness-post-0023-invitation-token-recovery-backup-${hostedAcceptanceProjectRef}`;

export function renderHostedPhase93MigrationBackupExecutorPlan() {
  return `Hosted Phase 93 migration 0023 backup/rebuild executor plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedPhase93MigrationBackupId}.
Fixed evidence directory: ${hostedPhase93MigrationBackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedPhase93MigrationPreCaptureReadinessArgument}
- isolated rebuild: ${hostedPhase93MigrationRebuildReadinessArgument}
- post capture: ${hostedPhase93MigrationPostCaptureReadinessArgument}
Exact confirmation-gated write operations:
- pre capture: ${hostedPhase93MigrationCapturePreArgument}
- isolated rebuild: ${hostedPhase93MigrationRebuildArgument}
- post capture: ${hostedPhase93MigrationCapturePostArgument}
Execution contract:
- Pre capture requires head 20260828010000; post capture requires 20260831010000.
- The networkless scratch applies exactly 23 repository migrations through 20260831010000, verifies contracts, destroys scratch, and only then writes a manifest.
- Readiness proves clean pushed source, clone-local ignore, pinned runtime, FileVault, fixed Docker target, platform lock, and local digest identities without pulling, connecting to Hosted, or writing evidence.
- Phase 92 0022 evidence remains immutable and is never accepted as Phase 93 evidence.
Current result: this plan reports only the reviewed fixed contract and performs no operation.
`;
}

export async function runHostedPhase93MigrationBackupExecutorCli({
  arguments_ = process.argv.slice(2),
  captureBackup = captureHostedPhase93MigrationBackup,
  environment = process.env,
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readCaptureSecrets = readHostedImportantBatchCaptureSecrets,
  readRepositoryState = readHostedPhase93MigrationBackupRepositoryState,
  rebuildScratch = rebuildHostedPhase93MigrationScratch,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase93MigrationBackupExecutorPlan());
    return 0;
  }
  const operation = new Map([
    [hostedPhase93MigrationPreCaptureReadinessArgument, { kind: "readiness", phase: "pre" }],
    [hostedPhase93MigrationRebuildReadinessArgument, { kind: "readiness", phase: "rebuild" }],
    [hostedPhase93MigrationPostCaptureReadinessArgument, { kind: "readiness", phase: "post" }],
    [hostedPhase93MigrationCapturePreArgument, { kind: "capture", phase: "pre" }],
    [hostedPhase93MigrationRebuildArgument, { kind: "rebuild", phase: "rebuild" }],
    [hostedPhase93MigrationCapturePostArgument, { kind: "capture", phase: "post" }],
  ]).get(arguments_.length === 1 ? arguments_[0] : null);
  if (operation === undefined) {
    writeError("Hosted Phase 93 migration backup executor arguments are invalid.\n");
    return 1;
  }
  if (operation.kind === "capture") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
    } catch {
      writeError("Hosted Phase 93 migration backup executor operation failed closed.\n");
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
        : "Hosted Phase 93 migration backup executor operation failed closed.\n",
    );
    return 1;
  }
  try {
    if (operation.kind === "readiness") {
      writeOutput(`Hosted Phase 93 migration ${operation.phase} readiness passed.\n`);
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
      writeOutput(`Hosted Phase 93 migration ${operation.phase} backup captured.\n`);
      return 0;
    }
    await rebuildScratch({ candidateCommit: readiness.candidateCommit, repositoryRoot: root });
    writeOutput("Hosted Phase 93 migration isolated rebuild verified and destroyed.\n");
    return 0;
  } catch (error) {
    const stage =
      operation.kind === "rebuild" ? readHostedImportantBatchRebuildFailureStage(error) : null;
    writeError(
      stage === null
        ? "Hosted Phase 93 migration backup executor operation failed closed.\n"
        : renderHostedImportantBatchRebuildFailure(stage),
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase93MigrationBackupExecutorCli();
}
