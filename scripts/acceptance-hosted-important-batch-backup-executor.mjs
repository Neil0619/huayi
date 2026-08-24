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
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  inspectHostedSupabasePlatformImages,
  readHostedSupabasePlatformImageLock,
  verifyHostedSupabasePlatformImageLock,
} from "./acceptance-hosted-supabase-platform-lock.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pinnedSupabaseCliVersion = "2.115.0";
const fixedSessionPooler = "aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
const executorImplementationPinned = false;
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
      pinnedPostgres17RuntimeReady: false,
      pinnedScratchRuntimeReady: false,
      supabaseCliPinned: false,
    };
  }
  const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
  const [docker, supabase, artifactEncryption, platformImages] = await Promise.all([
    runInspection(dockerTarget.command, [
      "--host",
      dockerTarget.host,
      "version",
      "--format",
      "{{.Server.Version}}",
    ]),
    runInspection(supabaseCommand, ["--version"]),
    runInspection("/usr/bin/fdesetup", ["status"]),
    (async () => {
      try {
        await verifyPlatformLock();
        const lock = await readPlatformLock();
        return await inspectPlatformImages({
          lock,
          resolveDockerTarget: async () => dockerTarget,
        });
      } catch {
        return { ready: false };
      }
    })(),
  ]);
  return {
    artifactEncryptionReady:
      process.platform === "darwin" &&
      artifactEncryption.code === 0 &&
      artifactEncryption.stdout.trim() === "FileVault is On.",
    dockerDaemonReady: docker.code === 0 && /^\d+\.\d+(?:\.\d+)?$/u.test(docker.stdout.trim()),
    pinnedPostgres17RuntimeReady: platformImages.ready === true,
    pinnedScratchRuntimeReady: platformImages.ready === true,
    supabaseCliPinned: supabase.code === 0 && supabase.stdout.trim() === pinnedSupabaseCliVersion,
  };
}

function repositoryStateIsReady(state) {
  return (
    state?.artifactRootIgnored === true &&
    state.worktreeClean === true &&
    typeof state.candidateCommit === "string" &&
    /^[0-9a-f]{40}$/u.test(state.candidateCommit)
  );
}

function runtimeIsReady(runtime) {
  return (
    runtime?.artifactEncryptionReady === true &&
    runtime.dockerDaemonReady === true &&
    runtime.pinnedPostgres17RuntimeReady === true &&
    runtime.pinnedScratchRuntimeReady === true &&
    runtime.supabaseCliPinned === true &&
    executorImplementationPinned
  );
}

export function renderHostedImportantBatchBackupExecutorPlan() {
  return `Hosted important-batch capture/rebuild executor readiness plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedImportantBatchId}.
Fixed evidence directory: ${hostedImportantBatchBackupArtifactDirectory}
Exact readiness operations:
- pre capture: ${hostedImportantBatchPreCaptureReadinessArgument}
- isolated rebuild: ${hostedImportantBatchRebuildReadinessArgument}
- post capture: ${hostedImportantBatchPostCaptureReadinessArgument}
Connection and process contract:
- A future executor must use the fixed verify-full administrator session pooler port 5432 at ${fixedSessionPooler}; transaction pooler port 6543 is forbidden for dump/restore.
- PostgreSQL client commands must run only from ${hostedImportantBatchPostgresImage}; host-installed pg_dump/pg_restore/psql are never trusted.
- The Hosted password is written only to a fixed 0600 temporary .pgpass and mounted read-only; the container receives only the fixed PGPASSFILE path, never PGPASSWORD or a secret-bearing Docker argument. The CA PEM is accepted only from HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, written to a fixed 0600 temporary file, mounted read-only, and exposed only as the fixed PGSSLROOTCERT path.
- Commands use shell false and fixed argument arrays. Project, database URL, artifact path, phase, migration head, and operation are never caller supplied.
Capture contract:
- The pinned PostgreSQL 17 database image is also the only permitted pg_dump/pg_restore/psql runtime. The installed Supabase CLI ${pinnedSupabaseCliVersion} has no custom-format flag and its filtered SQL export must not be labelled postgres-custom.
- The future full-database custom archive may include accessible application schemas, migration history, Auth database rows, and Storage metadata only after internal fixed coverage checks pass.
- The archive does not include Storage object bytes. It also does not include global roles or hosted platform configuration such as Auth providers, SMTP, DNS, Edge Functions, or environment secrets.
- Storage object count must be proven zero before capture; otherwise a separately approved Storage object export is required and this batch remains blocked.
- Create only fixed 0700 directories and fixed 0600 files below the ignored evidence directory. Write a partial file, fsync the closed archive, hash and size it, use atomic rename, fsync its directory, then write the canonical manifest last by the same partial/fsync/atomic sequence.
- Every failure removes only the fixed partial file, CA file, manifest temporary file, and scratch temporary files. Database rows, identities, secrets, archive contents, and raw stdout or stderr are never logged or reflected.
Isolated rebuild contract:
- Start from an empty non-production scratch with a repository-pinned image digest and distinct fixed project identity; never reuse the local acceptance or Hosted database.
- The repository-pinned platform lock classifies all 14 CLI start services for the fixed config: 11 enabled images and three disabled services. Every enabled exact tag pins its OCI/Docker index plus linux/amd64 and linux/arm64 platform manifests.
- Before any future start, run the static lock verifier and the local-only image inspector. The inspector issues only fixed Unix-socket Docker image-inspect commands against index-digest references; it has no pull, build, run, start, or manifest-network command.
- Apply exactly the repository migrations through 20260824010000 plus the fictional seed, run fixed bounded migration/runtime/absence contracts, prove Hosted data absent, and destroy scratch before writing the rebuild manifest last.
Current result: blocked fail-closed. The complete 11-image platform lock exists and this macOS host's local-only image inspection passes, but the reviewed write executor does not exist. Supabase CLI start can pull on a cache miss, so ordinary start remains forbidden; any later execution host must independently pass the same local-only inspector. Readiness uses only the platform-fixed local Unix Docker socket, fixed Docker executable, local image metadata, pinned CLI version, and FileVault status; it cannot pull images, connect to Hosted, or create evidence.
`;
}

export async function runHostedImportantBatchBackupExecutorCli({
  arguments_ = process.argv.slice(2),
  inspectRuntime = inspectHostedImportantBatchBackupRuntime,
  readRepositoryState = readHostedImportantBatchBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedImportantBatchBackupExecutorPlan());
    return 0;
  }
  const argument = arguments_.length === 1 ? arguments_[0] : null;
  if (
    argument !== hostedImportantBatchPreCaptureReadinessArgument &&
    argument !== hostedImportantBatchRebuildReadinessArgument &&
    argument !== hostedImportantBatchPostCaptureReadinessArgument
  ) {
    writeError("Hosted important-batch executor arguments are invalid.\n");
    return 1;
  }
  try {
    const repositoryState = await readRepositoryState(root);
    if (!repositoryStateIsReady(repositoryState)) {
      throw new Error("Hosted important-batch executor repository state is invalid.");
    }
    const runtime = await inspectRuntime();
    if (!runtimeIsReady(runtime)) {
      throw new Error("Hosted important-batch executor runtime is unavailable.");
    }
    throw new Error("Hosted important-batch executor is not implemented.");
  } catch {
    writeError(
      "Hosted important-batch executor readiness failed closed; no operation was performed.\n",
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedImportantBatchBackupExecutorCli();
}
