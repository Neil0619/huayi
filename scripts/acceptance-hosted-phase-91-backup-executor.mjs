import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectHostedImportantBatchBackupRuntime } from "./acceptance-hosted-important-batch-backup-executor.mjs";
import {
  hostedPhase91BackupArtifactDirectory,
  hostedPhase91BackupId,
  readHostedPhase91BackupRepositoryState,
} from "./acceptance-hosted-phase-91-backup.mjs";
import {
  captureHostedPhase91Backup,
  hostedPhase91CapturePostArgument,
  hostedPhase91CapturePreArgument,
} from "./acceptance-hosted-phase-91-capture.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
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
import {
  hostedPhase91RebuildArgument,
  rebuildHostedPhase91Scratch,
} from "./acceptance-hosted-phase-91-rebuild.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const hostedPhase91PreCaptureReadinessArgument = `--readiness-pre-0015-public-function-acl-hardening-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase91RebuildReadinessArgument = `--readiness-rebuild-0015-public-function-acl-hardening-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase91PostCaptureReadinessArgument = `--readiness-post-0015-public-function-acl-hardening-backup-${hostedAcceptanceProjectRef}`;

export function renderHostedPhase91BackupExecutorPlan() {
  return `Hosted Phase 91 backup/rebuild executor plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedPhase91BackupId}.
Fixed evidence directory: ${hostedPhase91BackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedPhase91PreCaptureReadinessArgument}
- isolated rebuild: ${hostedPhase91RebuildReadinessArgument}
- post capture: ${hostedPhase91PostCaptureReadinessArgument}
Exact confirmation-gated write operations:
- pre capture: ${hostedPhase91CapturePreArgument}
- isolated rebuild: ${hostedPhase91RebuildArgument}
- post capture: ${hostedPhase91CapturePostArgument}
Execution contract:
- Pre capture requires migration head 20260824010000; post capture requires 20260825010000. Both use the fixed verify-full administrator session pooler port 5432, official CA, fixed administrator Keychain account, digest-only PostgreSQL 17 client, zero inherited password, zero reflected child output, and fixed private evidence paths.
- The isolated networkless scratch applies exactly 15 repository migrations through 20260825010000 plus the fictional seed, verifies Auth/Storage/runtime/absence contracts, destroys the scratch, and only then writes its canonical manifest. It has zero Hosted connection and never reads a Hosted password.
- Readiness proves the clean candidate, clone-local ignore, pinned CLI, FileVault, fixed local Docker target, platform lock, and all local digest identities without pulling, connecting to Hosted, or writing evidence.
- Phase 81 evidence is immutable and never read, overwritten, or accepted as Phase 91 evidence.
Current result: this plan reports only the reviewed fixed contract. It does not claim that readiness, capture, rebuild, migration, or completion has run.
`;
}

export async function runHostedPhase91BackupExecutorCli({
  arguments_ = process.argv.slice(2),
  captureBackup = captureHostedPhase91Backup,
  environment = process.env,
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readCaptureSecrets = readHostedImportantBatchCaptureSecrets,
  readRepositoryState = readHostedPhase91BackupRepositoryState,
  rebuildScratch = rebuildHostedPhase91Scratch,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase91BackupExecutorPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  const operations = new Map([
    [hostedPhase91PreCaptureReadinessArgument, { kind: "readiness", phase: "pre" }],
    [hostedPhase91RebuildReadinessArgument, { kind: "readiness", phase: "rebuild" }],
    [hostedPhase91PostCaptureReadinessArgument, { kind: "readiness", phase: "post" }],
    [hostedPhase91CapturePreArgument, { kind: "capture", phase: "pre" }],
    [hostedPhase91RebuildArgument, { kind: "rebuild", phase: "rebuild" }],
    [hostedPhase91CapturePostArgument, { kind: "capture", phase: "post" }],
  ]);
  const operation = operations.get(argument);
  if (operation === undefined) {
    writeError("Hosted Phase 91 backup executor arguments are invalid.\n");
    return 1;
  }
  if (operation.kind === "capture") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
    } catch {
      writeError("Hosted Phase 91 backup executor operation failed closed.\n");
      return 1;
    }
  }

  const readiness = await assessHostedImportantBatchReadiness({
    inspectRuntime,
    readRepositoryState,
    repositoryRoot: root,
  });
  if (!readiness.ready) {
    writeError(
      operation.kind === "readiness"
        ? renderHostedImportantBatchReadinessFailure(readiness.failedStage ?? "runtime-inspection")
        : "Hosted Phase 91 backup executor operation failed closed.\n",
    );
    return 1;
  }

  try {
    if (operation.kind === "readiness") {
      writeOutput(`Hosted Phase 91 ${operation.phase} readiness passed.\n`);
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
      writeOutput(`Hosted Phase 91 ${operation.phase} backup captured.\n`);
      return 0;
    }
    await rebuildScratch({
      candidateCommit: readiness.candidateCommit,
      repositoryRoot: root,
    });
    writeOutput("Hosted Phase 91 isolated rebuild verified and destroyed.\n");
    return 0;
  } catch (error) {
    const rebuildFailureStage =
      operation.kind === "rebuild" ? readHostedImportantBatchRebuildFailureStage(error) : null;
    writeError(
      rebuildFailureStage === null
        ? "Hosted Phase 91 backup executor operation failed closed.\n"
        : renderHostedImportantBatchRebuildFailure(rebuildFailureStage),
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase91BackupExecutorCli();
}
