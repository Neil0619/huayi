import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectHostedImportantBatchBackupRuntime } from "./acceptance-hosted-important-batch-backup-executor.mjs";
import {
  hostedDeepseekMigrationBackupArtifactDirectory,
  hostedDeepseekMigrationBackupId,
  readHostedDeepseekMigrationBackupRepositoryState,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import {
  captureHostedDeepseekMigrationBackup,
  hostedDeepseekMigrationCapturePostArgument,
  hostedDeepseekMigrationCapturePreArgument,
} from "./acceptance-hosted-deepseek-migration-capture.mjs";
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
  hostedDeepseekMigrationRebuildArgument,
  rebuildHostedDeepseekMigrationScratch,
} from "./acceptance-hosted-deepseek-migration-rebuild.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedDeepseekMigrationPreCaptureReadinessArgument = `--readiness-pre-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationRebuildReadinessArgument = `--readiness-rebuild-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationPostCaptureReadinessArgument = `--readiness-post-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;

export function renderHostedDeepseekMigrationBackupExecutorPlan() {
  return `Hosted DeepSeek 0016-0021 backup/rebuild executor plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedDeepseekMigrationBackupId}.
Fixed evidence directory: ${hostedDeepseekMigrationBackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedDeepseekMigrationPreCaptureReadinessArgument}
- isolated rebuild: ${hostedDeepseekMigrationRebuildReadinessArgument}
- post capture: ${hostedDeepseekMigrationPostCaptureReadinessArgument}
Exact confirmation-gated write operations:
- pre capture: ${hostedDeepseekMigrationCapturePreArgument}
- isolated rebuild: ${hostedDeepseekMigrationRebuildArgument}
- post capture: ${hostedDeepseekMigrationCapturePostArgument}
Execution contract:
- Pre capture requires head 20260825010000; post capture requires 20260827060000. Both use the fixed verify-full administrator session pooler port 5432, official CA, fixed administrator Keychain account, zero inherited password, and fixed private evidence paths.
- The networkless scratch applies exactly 21 repository migrations through 20260827060000 plus the fictional seed, verifies runtime and absence contracts, destroys scratch, and only then writes a manifest. It has zero Hosted connection and never reads a Hosted password.
- Readiness proves clean pushed source, clone-local ignore, pinned runtime, FileVault, fixed Docker target, platform lock, and local digest identities without pulling, connecting to Hosted, or writing evidence.
- Phase 91 evidence remains immutable and is never read or accepted as 0016-0021 evidence.
Current result: this plan reports only the reviewed fixed contract and performs no operation.
`;
}

export async function runHostedDeepseekMigrationBackupExecutorCli({
  arguments_ = process.argv.slice(2),
  captureBackup = captureHostedDeepseekMigrationBackup,
  environment = process.env,
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readCaptureSecrets = readHostedImportantBatchCaptureSecrets,
  readRepositoryState = readHostedDeepseekMigrationBackupRepositoryState,
  rebuildScratch = rebuildHostedDeepseekMigrationScratch,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedDeepseekMigrationBackupExecutorPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  const operation = new Map([
    [hostedDeepseekMigrationPreCaptureReadinessArgument, { kind: "readiness", phase: "pre" }],
    [hostedDeepseekMigrationRebuildReadinessArgument, { kind: "readiness", phase: "rebuild" }],
    [hostedDeepseekMigrationPostCaptureReadinessArgument, { kind: "readiness", phase: "post" }],
    [hostedDeepseekMigrationCapturePreArgument, { kind: "capture", phase: "pre" }],
    [hostedDeepseekMigrationRebuildArgument, { kind: "rebuild", phase: "rebuild" }],
    [hostedDeepseekMigrationCapturePostArgument, { kind: "capture", phase: "post" }],
  ]).get(argument);
  if (operation === undefined) {
    writeError("Hosted DeepSeek migration backup executor arguments are invalid.\n");
    return 1;
  }
  if (operation.kind === "capture") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
    } catch {
      writeError("Hosted DeepSeek migration backup executor operation failed closed.\n");
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
        : "Hosted DeepSeek migration backup executor operation failed closed.\n",
    );
    return 1;
  }

  try {
    if (operation.kind === "readiness") {
      writeOutput(`Hosted DeepSeek migration ${operation.phase} readiness passed.\n`);
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
      writeOutput(`Hosted DeepSeek migration ${operation.phase} backup captured.\n`);
      return 0;
    }
    await rebuildScratch({
      candidateCommit: readiness.candidateCommit,
      repositoryRoot: root,
    });
    writeOutput("Hosted DeepSeek migration isolated rebuild verified and destroyed.\n");
    return 0;
  } catch (error) {
    const stage =
      operation.kind === "rebuild" ? readHostedImportantBatchRebuildFailureStage(error) : null;
    writeError(
      stage === null
        ? "Hosted DeepSeek migration backup executor operation failed closed.\n"
        : renderHostedImportantBatchRebuildFailure(stage),
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationBackupExecutorCli();
}
