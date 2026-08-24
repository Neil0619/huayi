import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchId,
  readHostedImportantBatchBackupRepositoryState,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pinnedSupabaseCliVersion = "2.115.0";
const fixedSessionPooler = "aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
const executorImplementationPinned = false;

export const hostedImportantBatchPreCaptureReadinessArgument = `--readiness-pre-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchRebuildReadinessArgument = `--readiness-rebuild-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchPostCaptureReadinessArgument = `--readiness-post-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;

function runBoundedInspection(command, arguments_, { timeoutMilliseconds = 5_000 } = {}) {
  return new Promise((resolveResult) => {
    let settled = false;
    let stdout = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: {
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout: "" });
    }, timeoutMilliseconds);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 256) stdout += chunk.slice(0, 256 - stdout.length);
    });
    child.once("error", () => finish({ code: null, stdout: "" }));
    child.once("exit", (code, signal) => {
      finish({ code: signal === null ? code : null, stdout });
    });
  });
}

function isPostgres17Version(command, stdout) {
  return new RegExp(`^${command} \\(PostgreSQL\\) 17(?:\\.|$)`, "u").test(stdout.trim());
}

export async function inspectHostedImportantBatchBackupRuntime({
  runInspection = runBoundedInspection,
} = {}) {
  const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
  const [pgDump, pgRestore, psql, supabase, docker] = await Promise.all([
    runInspection("pg_dump", ["--version"]),
    runInspection("pg_restore", ["--version"]),
    runInspection("psql", ["--version"]),
    runInspection(supabaseCommand, ["--version"]),
    runInspection("docker", [
      "--host",
      "unix:///var/run/docker.sock",
      "version",
      "--format",
      "{{.Server.Version}}",
    ]),
  ]);
  return {
    dockerDaemonReady: docker.code === 0 && /^\d+\.\d+(?:\.\d+)?$/u.test(docker.stdout.trim()),
    pinnedPostgres17RuntimeReady:
      pgDump.code === 0 &&
      isPostgres17Version("pg_dump", pgDump.stdout) &&
      pgRestore.code === 0 &&
      isPostgres17Version("pg_restore", pgRestore.stdout) &&
      psql.code === 0 &&
      isPostgres17Version("psql", psql.stdout),
    pinnedScratchRuntimeReady: false,
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
    runtime?.dockerDaemonReady === true &&
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
- PGPASSWORD exists only in the child-process environment. The CA PEM is accepted only from HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, written to a fixed 0600 temporary file, and exposed only as PGSSLROOTCERT.
- Commands use shell false and fixed argument arrays. Project, database URL, artifact path, phase, migration head, and operation are never caller supplied.
Capture contract:
- A repository-pinned PostgreSQL 17 pg_dump/pg_restore/psql runtime is required. The installed Supabase CLI ${pinnedSupabaseCliVersion} has no custom-format flag and its filtered SQL export must not be labelled postgres-custom.
- The future full-database custom archive may include accessible application schemas, migration history, Auth database rows, and Storage metadata only after internal fixed coverage checks pass.
- The archive does not include Storage object bytes. It also does not include global roles or hosted platform configuration such as Auth providers, SMTP, DNS, Edge Functions, or environment secrets.
- Storage object count must be proven zero before capture; otherwise a separately approved Storage object export is required and this batch remains blocked.
- Create only fixed 0700 directories and fixed 0600 files below the ignored evidence directory. Write a partial file, fsync the closed archive, hash and size it, use atomic rename, fsync its directory, then write the canonical manifest last by the same partial/fsync/atomic sequence.
- Every failure removes only the fixed partial file, CA file, manifest temporary file, and scratch temporary files. Database rows, identities, secrets, archive contents, and raw stdout or stderr are never logged or reflected.
Isolated rebuild contract:
- Start from an empty non-production scratch with a repository-pinned image digest and distinct fixed project identity; never reuse the local acceptance or Hosted database.
- Apply exactly the repository migrations through 20260824010000 plus the fictional seed, run fixed bounded migration/runtime/absence contracts, prove Hosted data absent, and destroy scratch before writing the rebuild manifest last.
Current result: blocked fail-closed. This repository has no pinned PostgreSQL 17 execution runtime, pinned isolated-scratch image digest, or reviewed write executor. Readiness commands perform local inspection only and cannot create evidence.
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
