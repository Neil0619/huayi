import { chmod, lstat, open } from "node:fs/promises";

import {
  assertFixedLocalDockerTarget,
  hostedImportantBatchPostgresRuntimeReference,
  inspectHostedImportantBatchContainer,
  isHostedImportantBatchContainerAbsent,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { hostedImportantBatchPostgresImageReadySql } from "./acceptance-hosted-important-batch-rebuild-sql.mjs";
import { assertHostedRestoreFictionalToc } from "./acceptance-hosted-restore-drill-fictional-fixture.mjs";

export const hostedRestoreFictionalSourceContainer = "huayi-phase-87-fictional-source";
export const hostedRestoreFictionalTargetContainer = "huayi-phase-87-fictional-target";

const tmpfsContract = "rw,nosuid,nodev,noexec,size=2147483648,mode=0700";
const archivePathInContainer = "/tmp/seen-said-fictional.dump";

function fail() {
  throw new Error("Hosted restore-drill fictional archive failed.");
}

export function fictionalDockerArguments(target, tail) {
  assertFixedLocalDockerTarget(target);
  return ["--host", target.host, ...tail];
}

function labelFor(name) {
  return `phase-87-fictional-${name}`;
}

export function fictionalRuntimeIsExact(source, name) {
  try {
    const inspected = JSON.parse(source);
    return (
      inspected?.Config?.Image === hostedImportantBatchPostgresRuntimeReference &&
      inspected?.Config?.Labels?.["com.seen-said.acceptance"] === labelFor(name) &&
      inspected?.HostConfig?.NetworkMode === "none" &&
      inspected?.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] === tmpfsContract &&
      (inspected?.HostConfig?.Binds === null || inspected?.HostConfig?.Binds?.length === 0) &&
      Array.isArray(inspected?.Mounts) &&
      inspected.Mounts.length === 0
    );
  } catch {
    return false;
  }
}

export function inspectFictionalContainer(dockerTarget, name, runProcess) {
  return inspectHostedImportantBatchContainer(dockerTarget, name, runProcess);
}

export async function assertFictionalIdentityAvailable(dockerTarget, name, runProcess) {
  const inspected = await inspectFictionalContainer(dockerTarget, name, runProcess);
  if (!isHostedImportantBatchContainerAbsent(inspected)) fail();
}

export function startFictionalContainer(dockerTarget, name, runProcess) {
  return runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, [
      "run",
      "--detach",
      "--rm",
      "--pull",
      "never",
      "--name",
      name,
      "--label",
      `com.seen-said.acceptance=${labelFor(name)}`,
      "--network",
      "none",
      "--tmpfs",
      `/var/lib/postgresql/data:${tmpfsContract}`,
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--env",
      "POSTGRES_DB=postgres",
      hostedImportantBatchPostgresRuntimeReference,
    ]),
    { maxOutputBytes: 256 },
  );
}

export function fictionalPsqlArguments(name) {
  return [
    "exec",
    "-i",
    name,
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    "supabase_admin",
    "--dbname",
    "postgres",
  ];
}

export async function runFictionalSql(dockerTarget, name, runProcess, input, expectedOutput = "") {
  const result = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, fictionalPsqlArguments(name)),
    { input, maxOutputBytes: 4_096 },
  );
  if (result.code !== 0 || result.stdout !== expectedOutput) fail();
}

export async function waitForFictionalContainer(dockerTarget, name, runProcess, wait, now) {
  const deadline = now() + 300_000;
  for (let attempt = 0; attempt < 1_200 && now() < deadline; attempt += 1) {
    const pid = await runProcess(
      dockerTarget.command,
      fictionalDockerArguments(dockerTarget, [
        "exec",
        name,
        "head",
        "-n",
        "1",
        "/var/lib/postgresql/data/postmaster.pid",
      ]),
      { maxOutputBytes: 16, timeoutMilliseconds: 5_000 },
    );
    const ready =
      pid.code === 0 && pid.stdout === "1\n"
        ? await runProcess(
            dockerTarget.command,
            fictionalDockerArguments(dockerTarget, [
              "exec",
              name,
              "pg_isready",
              "--quiet",
              "--username",
              "postgres",
              "--dbname",
              "postgres",
            ]),
            { maxOutputBytes: 1, timeoutMilliseconds: 5_000 },
          )
        : { code: 1, stdout: "" };
    if (ready.code === 0 && ready.stdout === "") {
      try {
        await runFictionalSql(
          dockerTarget,
          name,
          runProcess,
          hostedImportantBatchPostgresImageReadySql,
          "postgres_image_ready|t\n",
        );
        return;
      } catch {
        // Image initialization can still be completing after pg_isready.
      }
    }
    await wait(250);
  }
  fail();
}

export async function createFictionalArchive(dockerTarget, runProcess) {
  const result = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, [
      "exec",
      hostedRestoreFictionalSourceContainer,
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--no-comments",
      "--no-publications",
      "--no-security-labels",
      "--no-subscriptions",
      "--no-table-access-method",
      "--no-tablespaces",
      "--table=public.profiles",
      "--table=public.analysis_jobs",
      "--table=public.admin_job_projection",
      "--table=auth.users",
      "--table=auth.identities",
      "--table=storage.buckets",
      "--table=storage.objects",
      "--table=huayi_private.audit_events",
      "--table=supabase_migrations.schema_migrations",
      `--file=${archivePathInContainer}`,
      "--username=supabase_admin",
      "--dbname=postgres",
    ]),
    { maxOutputBytes: 1 },
  );
  if (result.code !== 0 || result.stdout !== "") fail();
  const listed = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, [
      "exec",
      hostedRestoreFictionalSourceContainer,
      "pg_restore",
      "--list",
      archivePathInContainer,
    ]),
    { maxOutputBytes: 65_536 },
  );
  if (listed.code !== 0) fail();
  assertHostedRestoreFictionalToc(listed.stdout);
}

export async function copyFictionalArchiveToHost(dockerTarget, runProcess, archivePath) {
  const copied = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, [
      "cp",
      `${hostedRestoreFictionalSourceContainer}:${archivePathInContainer}`,
      archivePath,
    ]),
    { maxOutputBytes: 1 },
  );
  if (copied.code !== 0 || copied.stdout !== "") fail();
  await chmod(archivePath, 0o600);
  const stats = await lstat(archivePath);
  if (
    !stats.isFile() ||
    stats.size < 6 ||
    stats.size > 67_108_864 ||
    (stats.mode & 0o777) !== 0o600
  ) {
    fail();
  }
  const handle = await open(archivePath, "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString("ascii") !== "PGDMP") fail();
  } finally {
    await handle.close();
  }
}

export async function restoreFictionalArchive(dockerTarget, runProcess, archivePath) {
  const copied = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, [
      "cp",
      archivePath,
      `${hostedRestoreFictionalTargetContainer}:${archivePathInContainer}`,
    ]),
    { maxOutputBytes: 1 },
  );
  if (copied.code !== 0 || copied.stdout !== "") fail();
  const restored = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, [
      "exec",
      hostedRestoreFictionalTargetContainer,
      "pg_restore",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--username=supabase_admin",
      "--dbname=postgres",
      archivePathInContainer,
    ]),
    { maxOutputBytes: 1 },
  );
  if (restored.code !== 0 || restored.stdout !== "") fail();
}

export function destroyFictionalContainer(dockerTarget, name, runProcess, wait, late) {
  return settleHostedImportantBatchContainer({
    dockerTarget,
    name,
    runProcess,
    runtimeIsExact: (source) => fictionalRuntimeIsExact(source, name),
    wait,
    waitForLateAppearance: late,
  });
}
