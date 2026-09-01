import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  resolveLocalDockerInspectionTarget,
  runBoundedLocalInspection,
} from "./acceptance-local-docker-inspection.mjs";
import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchId,
  readHostedImportantBatchBackupRepositoryState,
} from "./acceptance-hosted-important-batch-backup.mjs";
import {
  captureHostedImportantBatchBackup,
  hostedImportantBatchCapturePostArgument,
  hostedImportantBatchCapturePreArgument,
} from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import {
  hostedImportantBatchRebuildArgument,
  rebuildHostedImportantBatchScratch,
} from "./acceptance-hosted-important-batch-rebuild.mjs";
import {
  readHostedImportantBatchRebuildFailureStage,
  renderHostedImportantBatchRebuildFailure,
} from "./acceptance-hosted-important-batch-rebuild-diagnostic.mjs";
import { readHostedImportantBatchCaptureSecrets } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { rejectLegacyHostedCredentialEnvironment } from "./acceptance-hosted-credentials.mjs";
import {
  assessHostedImportantBatchReadiness,
  renderHostedImportantBatchReadinessFailure,
} from "./acceptance-hosted-important-batch-readiness-diagnostic.mjs";
import {
  inspectHostedSupabasePlatformImages,
  readHostedSupabasePlatformImageLock,
  verifyHostedSupabasePlatformImageLock,
} from "./acceptance-hosted-supabase-platform-lock.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pinnedSupabaseCliVersion = "2.115.0";
const fixedSessionPooler = "aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
const executorImplementationPinned = true;
const pinnedPostgresImageDigest =
  "sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f";

export const hostedImportantBatchPostgresImage = `docker.io/supabase/postgres:17.6.1.159@${pinnedPostgresImageDigest}`;

export const hostedImportantBatchPreCaptureReadinessArgument = `--readiness-pre-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchRebuildReadinessArgument = `--readiness-rebuild-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchPostCaptureReadinessArgument = `--readiness-post-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;

const runBoundedInspection = (command, arguments_) =>
  runBoundedLocalInspection(command, arguments_, { maxOutputBytes: 256 });

export async function inspectHostedImportantBatchBackupRuntime({
  inspectPlatformImages = inspectHostedSupabasePlatformImages,
  platform = process.platform,
  readPlatformLock = readHostedSupabasePlatformImageLock,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runInspection = runBoundedInspection,
  verifyPlatformLock = verifyHostedSupabasePlatformImageLock,
} = {}) {
  let dockerTarget;
  try {
    dockerTarget = await resolveDockerTarget();
  } catch {
    return {
      artifactEncryptionReady: false,
      dockerDaemonReady: false,
      dockerTargetReady: false,
      localPlatformImagesReady: false,
      pinnedPostgres17RuntimeReady: false,
      pinnedScratchRuntimeReady: false,
      platformLockReady: false,
      supabaseCliPinned: false,
    };
  }
  const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
  const inspectProcess = async (command, arguments_) => {
    try {
      return await runInspection(command, arguments_);
    } catch {
      return { code: null, stdout: "" };
    }
  };
  const [docker, supabase, artifactEncryption, platformInspection] = await Promise.all([
    inspectProcess(dockerTarget.command, [
      "--host",
      dockerTarget.host,
      "version",
      "--format",
      "{{.Server.Version}}",
    ]),
    inspectProcess(supabaseCommand, ["--version"]),
    inspectProcess("/usr/bin/fdesetup", ["status"]),
    (async () => {
      try {
        await verifyPlatformLock();
        const lock = await readPlatformLock();
        try {
          const images = await inspectPlatformImages({
            lock,
            resolveDockerTarget: async () => dockerTarget,
          });
          return { imagesReady: images?.ready === true, lockReady: true };
        } catch {
          return { imagesReady: false, lockReady: true };
        }
      } catch {
        return { imagesReady: false, lockReady: false };
      }
    })(),
  ]);
  const localPlatformImagesReady = platformInspection.imagesReady === true;
  return {
    artifactEncryptionReady:
      platform === "darwin" &&
      artifactEncryption.code === 0 &&
      artifactEncryption.stdout.trim() === "FileVault is On.",
    dockerDaemonReady: docker.code === 0 && /^\d+\.\d+(?:\.\d+)?$/u.test(docker.stdout.trim()),
    dockerTargetReady: true,
    localPlatformImagesReady,
    pinnedPostgres17RuntimeReady: localPlatformImagesReady,
    pinnedScratchRuntimeReady: localPlatformImagesReady,
    platformLockReady: platformInspection.lockReady === true,
    supabaseCliPinned: supabase.code === 0 && supabase.stdout.trim() === pinnedSupabaseCliVersion,
  };
}

export function renderHostedImportantBatchBackupExecutorPlan() {
  return `Hosted important-batch capture/rebuild executor readiness plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedImportantBatchId}.
Fixed evidence directory: ${hostedImportantBatchBackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedImportantBatchPreCaptureReadinessArgument}
- isolated rebuild: ${hostedImportantBatchRebuildReadinessArgument}
- post capture: ${hostedImportantBatchPostCaptureReadinessArgument}
Exact confirmation-gated write operations:
- pre capture: ${hostedImportantBatchCapturePreArgument}
- isolated rebuild: ${hostedImportantBatchRebuildArgument}
- post capture: ${hostedImportantBatchCapturePostArgument}
Connection and process contract:
- The executor uses the fixed verify-full administrator session pooler port 5432 at ${fixedSessionPooler}; transaction pooler port 6543 is forbidden for dump/restore.
- PostgreSQL client commands run only from digest reference ${hostedImportantBatchPostgresRuntimeReference}; ${hostedImportantBatchPostgresImage} remains provenance only and is never an execution argument. Host-installed pg_dump/pg_restore/psql are never trusted.
- The executor fetches the CA PEM only from the fixed official Supabase CA URL with redirect rejection, bounded strict PEM validation, and a timeout before reading the fixed administrator Keychain account. The caller prepares no CA environment variable. The Hosted password is written only to a fixed 0600 temporary .pgpass and mounted read-only; the container receives only the fixed PGPASSFILE path, never PGPASSWORD or a secret-bearing Docker argument. The CA is written to a fixed 0600 temporary file, mounted read-only, and exposed only as the fixed PGSSLROOTCERT path.
- Commands use shell false and fixed argument arrays. Project, database URL, artifact path, phase, migration head, and operation are never caller supplied. Execution requires one exact confirmation argument and does not accept a dynamic path, URL, image, or project.
Capture contract:
- The pinned PostgreSQL 17 database image is also the only permitted pg_dump/pg_restore/psql runtime. The installed Supabase CLI ${pinnedSupabaseCliVersion} has no custom-format flag and its filtered SQL export must not be labelled postgres-custom.
- The full-database custom archive is committed only after internal fixed coverage checks prove application data, migration history, Auth database rows, and Storage metadata are present in the archive TOC.
- The archive does not include Storage object bytes. It also does not include global roles or hosted platform configuration such as Auth providers, SMTP, DNS, Edge Functions, or environment secrets.
- Storage object count must be proven zero before capture; otherwise a separately approved Storage object export is required and this batch remains blocked.
- Create only fixed 0700 directories and fixed 0600 files below the ignored evidence directory. Write a partial file, fsync the closed archive, hash and size it, use atomic rename, fsync its directory, then write the canonical manifest last by the same partial/fsync/atomic sequence.
- Every failure removes only the fixed partial file, CA file, manifest temporary file, and scratch temporary files. Database rows, identities, secrets, archive contents, and raw stdout or stderr are never logged or reflected.
Isolated rebuild contract:
- Start from an empty networkless non-production Supabase PostgreSQL scratch at the digest-only runtime reference and distinct fixed container identity; never reuse the local acceptance or Hosted database.
- The repository-pinned platform lock classifies all 14 CLI start services for the fixed config: 11 enabled images and three disabled services. Every enabled exact tag pins its OCI/Docker index plus linux/amd64 and linux/arm64 platform manifests.
- Before start, run the static lock verifier and the local-only image inspector. The inspector issues only fixed Unix-socket Docker image-inspect commands against index-digest references; it has no pull, build, run, start, or manifest-network command. The scratch uses --pull never, --network none, one tmpfs PGDATA, and no host or named data volume.
- After final-postmaster and Postgres-image-owned readiness, run only the lock-pinned GoTrue auth migrate, then Storage migrate-call. Each fixed runner shares only the networkless scratch namespace and uses loopback plus fictional local configuration; it has no port, bind, volume, pull, Hosted connection, or real credential. Runner failures expose only auth-baseline or storage-baseline and leave zero evidence.
- Apply exactly the repository migrations through 20260824010000 plus the fictional seed, run fixed bounded migration/runtime/absence contracts, prove Hosted data absent, and destroy scratch before writing the rebuild manifest last.
Current result: the reviewed writer is pinned. Readiness remains read-only and requires the clean candidate, static lock, platform-fixed local Unix Docker socket, all 11 local image identities, pinned CLI version, and FileVault status. The confirmation-gated pre/post capture and isolated rebuild operations are separate; readiness cannot pull images, connect to Hosted, or create evidence. Ordinary Supabase CLI start remains forbidden because it can pull on a cache miss.
Readiness failure output names only the first fixed allowlisted stage: repository state, Docker target, Docker daemon, Supabase CLI, FileVault, platform lock, local platform images, or the fixed runtime-inspection fallback. It never reflects an Error, process output, path, digest, secret, or environment value. Capture keeps its single generic failure boundary. A rebuild that starts execution may name only one internally selected fixed stage from source validation through evidence persistence; it never reflects the caught Error or child output.
`;
}

export async function runHostedImportantBatchBackupExecutorCli({
  arguments_ = process.argv.slice(2),
  captureBackup = captureHostedImportantBatchBackup,
  environment = process.env,
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readCaptureSecrets = readHostedImportantBatchCaptureSecrets,
  readRepositoryState = readHostedImportantBatchBackupRepositoryState,
  rebuildScratch = rebuildHostedImportantBatchScratch,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedImportantBatchBackupExecutorPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  const operations = new Map([
    [hostedImportantBatchPreCaptureReadinessArgument, { kind: "readiness", phase: "pre" }],
    [hostedImportantBatchRebuildReadinessArgument, { kind: "readiness", phase: "rebuild" }],
    [hostedImportantBatchPostCaptureReadinessArgument, { kind: "readiness", phase: "post" }],
    [hostedImportantBatchCapturePreArgument, { kind: "capture", phase: "pre" }],
    [hostedImportantBatchRebuildArgument, { kind: "rebuild", phase: "rebuild" }],
    [hostedImportantBatchCapturePostArgument, { kind: "capture", phase: "post" }],
  ]);
  const operation = operations.get(argument);
  if (operation === undefined) {
    writeError("Hosted important-batch executor arguments are invalid.\n");
    return 1;
  }
  if (operation.kind === "capture") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
    } catch {
      writeError("Hosted important-batch executor operation failed closed.\n");
      return 1;
    }
  }
  const readiness = await assessHostedImportantBatchReadiness({
    inspectRuntime,
    readRepositoryState,
    repositoryRoot: root,
  });
  if (!readiness.ready || !executorImplementationPinned) {
    writeError(
      operation.kind === "readiness"
        ? renderHostedImportantBatchReadinessFailure(readiness.failedStage ?? "runtime-inspection")
        : "Hosted important-batch executor operation failed closed.\n",
    );
    return 1;
  }
  try {
    if (operation.kind === "readiness") {
      writeOutput(`Hosted important-batch ${operation.phase} readiness passed.\n`);
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
      writeOutput(`Hosted important-batch ${operation.phase} backup captured.\n`);
      return 0;
    }
    await rebuildScratch({
      candidateCommit: readiness.candidateCommit,
      repositoryRoot: root,
    });
    writeOutput("Hosted important-batch isolated rebuild verified and destroyed.\n");
    return 0;
  } catch (error) {
    const rebuildFailureStage =
      operation.kind === "rebuild" ? readHostedImportantBatchRebuildFailureStage(error) : null;
    writeError(
      rebuildFailureStage === null
        ? "Hosted important-batch executor operation failed closed.\n"
        : renderHostedImportantBatchRebuildFailure(rebuildFailureStage),
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedImportantBatchBackupExecutorCli();
}
