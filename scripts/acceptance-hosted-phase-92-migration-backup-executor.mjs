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
  captureHostedPhase92MigrationBackup,
  hostedPhase92MigrationCapturePostArgument,
  hostedPhase92MigrationCapturePreArgument,
} from "./acceptance-hosted-phase-92-migration-capture.mjs";
import {
  hostedPhase92MigrationBackupArtifactDirectory,
  hostedPhase92MigrationBackupId,
  readHostedPhase92MigrationBackupRepositoryState,
} from "./acceptance-hosted-phase-92-migration-backup.mjs";
import {
  hostedPhase92MigrationRebuildArgument,
  rebuildHostedPhase92MigrationScratch,
} from "./acceptance-hosted-phase-92-migration-rebuild.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedPhase92MigrationPreCaptureReadinessArgument = `--readiness-pre-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase92MigrationRebuildReadinessArgument = `--readiness-rebuild-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase92MigrationPostCaptureReadinessArgument = `--readiness-post-0022-expired-invitation-recovery-backup-${hostedAcceptanceProjectRef}`;

export function renderHostedPhase92MigrationBackupExecutorPlan() {
  return `Hosted Phase 92 migration 0022 backup/rebuild executor plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedPhase92MigrationBackupId}.
Fixed evidence directory: ${hostedPhase92MigrationBackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedPhase92MigrationPreCaptureReadinessArgument}
- isolated rebuild: ${hostedPhase92MigrationRebuildReadinessArgument}
- post capture: ${hostedPhase92MigrationPostCaptureReadinessArgument}
Exact confirmation-gated write operations:
- pre capture: ${hostedPhase92MigrationCapturePreArgument}
- isolated rebuild: ${hostedPhase92MigrationRebuildArgument}
- post capture: ${hostedPhase92MigrationCapturePostArgument}
Execution contract:
- Pre capture requires head 20260827060000; post capture requires 20260828010000. Both use the fixed verify-full administrator session pooler port 5432, official CA, fixed administrator Keychain account, zero inherited password, and fixed private evidence paths.
- The networkless scratch applies exactly 22 repository migrations through 20260828010000 plus the fictional seed, verifies runtime and absence contracts, destroys scratch, and only then writes a manifest. It has zero Hosted connection and never reads a Hosted password.
- Readiness proves clean pushed source, clone-local ignore, pinned runtime, FileVault, fixed Docker target, platform lock, and local digest identities without pulling, connecting to Hosted, or writing evidence.
- DeepSeek 0016-0021 evidence remains immutable and is never read or accepted as Phase 92 evidence.
Current result: this plan reports only the reviewed fixed contract and performs no operation.
`;
}

export async function runHostedPhase92MigrationBackupExecutorCli({
  arguments_ = process.argv.slice(2),
  captureBackup = captureHostedPhase92MigrationBackup,
  environment = process.env,
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readCaptureSecrets = readHostedImportantBatchCaptureSecrets,
  readRepositoryState = readHostedPhase92MigrationBackupRepositoryState,
  rebuildScratch = rebuildHostedPhase92MigrationScratch,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase92MigrationBackupExecutorPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  const operation = new Map([
    [hostedPhase92MigrationPreCaptureReadinessArgument, { kind: "readiness", phase: "pre" }],
    [hostedPhase92MigrationRebuildReadinessArgument, { kind: "readiness", phase: "rebuild" }],
    [hostedPhase92MigrationPostCaptureReadinessArgument, { kind: "readiness", phase: "post" }],
    [hostedPhase92MigrationCapturePreArgument, { kind: "capture", phase: "pre" }],
    [hostedPhase92MigrationRebuildArgument, { kind: "rebuild", phase: "rebuild" }],
    [hostedPhase92MigrationCapturePostArgument, { kind: "capture", phase: "post" }],
  ]).get(argument);
  if (operation === undefined) {
    writeError("Hosted Phase 92 migration backup executor arguments are invalid.\n");
    return 1;
  }
  if (operation.kind === "capture") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
    } catch {
      writeError("Hosted Phase 92 migration backup executor operation failed closed.\n");
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
        : "Hosted Phase 92 migration backup executor operation failed closed.\n",
    );
    return 1;
  }

  try {
    if (operation.kind === "readiness") {
      writeOutput(`Hosted Phase 92 migration ${operation.phase} readiness passed.\n`);
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
      writeOutput(`Hosted Phase 92 migration ${operation.phase} backup captured.\n`);
      return 0;
    }
    await rebuildScratch({
      candidateCommit: readiness.candidateCommit,
      repositoryRoot: root,
    });
    writeOutput("Hosted Phase 92 migration isolated rebuild verified and destroyed.\n");
    return 0;
  } catch (error) {
    const stage =
      operation.kind === "rebuild" ? readHostedImportantBatchRebuildFailureStage(error) : null;
    writeError(
      stage === null
        ? "Hosted Phase 92 migration backup executor operation failed closed.\n"
        : renderHostedImportantBatchRebuildFailure(stage),
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase92MigrationBackupExecutorCli();
}
