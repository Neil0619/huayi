import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { hostedPhase81ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postgresDigest = "sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f";

export const hostedImportantBatchPostgresRuntimeReference = `docker.io/supabase/postgres@${postgresDigest}`;
export const hostedImportantBatchScratchContainer = hostedPhase81ArtifactContract.scratchContainer;
export const hostedImportantBatchSessionPoolerHost = "aws-0-ap-southeast-1.pooler.supabase.com";
export const hostedImportantBatchSessionPoolerPort = "5432";
export const hostedImportantBatchDatabaseName = "postgres";
export const hostedImportantBatchAdministratorUser = `postgres.${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchMigrationVersions =
  hostedPhase81ArtifactContract.migrationVersions;

export function assertFixedLocalDockerTarget(target) {
  if (
    target === null ||
    typeof target !== "object" ||
    typeof target.command !== "string" ||
    typeof target.host !== "string"
  ) {
    throw new Error("Hosted important-batch Docker target is invalid.");
  }
  const macTarget =
    target.command === "/Applications/OrbStack.app/Contents/MacOS/xbin/docker" &&
    /^unix:\/\/\/[^\0\r\n]+\/\.orbstack\/run\/docker\.sock$/u.test(target.host) &&
    !target.host.includes("/../");
  const linuxTarget =
    target.command === "/usr/bin/docker" && target.host === "unix:///var/run/docker.sock";
  if (!macTarget && !linuxTarget) {
    throw new Error("Hosted important-batch Docker target is invalid.");
  }
}

export function runHostedImportantBatchProcess(
  command,
  arguments_,
  { input, maxOutputBytes = 1_048_576, spawnProcess = spawn, timeoutMilliseconds = 1_800_000 } = {},
) {
  return new Promise((resolveResult) => {
    let settled = false;
    let stdout = "";
    let overflow = false;
    let forcedTermination = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const child = spawnProcess(command, arguments_, {
      cwd: repositoryRoot,
      env: { LANG: "C", LC_ALL: "C" },
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    timeout = setTimeout(() => {
      forcedTermination = true;
      child.kill("SIGKILL");
    }, timeoutMilliseconds);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > maxOutputBytes) {
        overflow = true;
        forcedTermination = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk;
    });
    child.once("error", () => finish({ code: null, stdout: "" }));
    child.once("close", (code, signal) => {
      finish({
        code: overflow || forcedTermination || signal !== null ? null : code,
        stdout: overflow || forcedTermination ? "" : stdout,
      });
    });
    if (input !== undefined) {
      child.stdin.once("error", () => undefined);
      child.stdin.end(input);
    }
  });
}

export function inspectHostedImportantBatchContainer(dockerTarget, name, runProcess) {
  assertFixedLocalDockerTarget(dockerTarget);
  return runProcess(
    dockerTarget.command,
    ["--host", dockerTarget.host, "container", "inspect", "--format", "{{json .}}", name],
    { maxOutputBytes: 32_768 },
  );
}

export function isHostedImportantBatchContainerAbsent(result) {
  return (
    result.code === 1 &&
    (result.stdout === "" || result.stdout === "\n" || result.stdout === "[]\n")
  );
}

export async function settleHostedImportantBatchContainer({
  dockerTarget,
  name,
  runProcess,
  runtimeIsExact,
  wait,
  waitForLateAppearance = false,
}) {
  const attempts = waitForLateAppearance ? 50 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const inspected = await inspectHostedImportantBatchContainer(dockerTarget, name, runProcess);
    if (isHostedImportantBatchContainerAbsent(inspected)) {
      if (attempt + 1 === attempts) return true;
      await wait(100);
      continue;
    }
    if (inspected.code !== 0 || !runtimeIsExact(inspected.stdout)) return false;
    const removed = await runProcess(
      dockerTarget.command,
      ["--host", dockerTarget.host, "rm", "--force", name],
      { maxOutputBytes: 128 },
    );
    if (removed.code !== 0 || removed.stdout !== `${name}\n`) return false;
    const afterRemoval = await inspectHostedImportantBatchContainer(dockerTarget, name, runProcess);
    return isHostedImportantBatchContainerAbsent(afterRemoval);
  }
  return true;
}

export function fixedDockerRunArguments(target, extraArguments) {
  assertFixedLocalDockerTarget(target);
  return [
    "--host",
    target.host,
    "run",
    "--rm",
    "--pull",
    "never",
    ...extraArguments,
    hostedImportantBatchPostgresRuntimeReference,
  ];
}
