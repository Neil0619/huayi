import { spawn } from "node:child_process";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";

const digestPattern = /^[0-9a-f]{64}$/u;
const inheritedSecretKeys = Object.freeze([
  "HUAYI_HOSTED_MANAGEMENT_TOKEN",
  "HUAYI_HOSTED_SOURCE_DATABASE_PASSWORD",
  "HUAYI_HOSTED_TARGET_DATABASE_PASSWORD",
  "PGPASSWORD",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
]);
const fixedChildCommands = new Set([
  "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  "/usr/bin/docker",
]);

function fail() {
  throw new Error("Hosted restore-drill process contract failed.");
}

export function assertHostedRestoreDrillSecretEnvironment(environment) {
  if (
    environment === null ||
    typeof environment !== "object" ||
    inheritedSecretKeys.some((key) => Object.hasOwn(environment, key))
  ) {
    fail();
  }
}

function assertSecret(value) {
  if (typeof value !== "string" || value.length < 1 || Buffer.byteLength(value) > 512) fail();
}

export async function readHostedRestoreDrillSecrets({
  environment = process.env,
  fetchCaCertificate,
  readHiddenLine = readHiddenTerminalLine,
} = {}) {
  assertHostedRestoreDrillSecretEnvironment(environment);
  if (typeof fetchCaCertificate !== "function") fail();
  const caCertificate = await fetchCaCertificate();
  const sourceAdministratorPassword = await readHiddenLine(
    "Source archive administrator database password: ",
  );
  const targetAdministratorPassword = await readHiddenLine(
    "Recovery project administrator database password: ",
  );
  const managementToken = await readHiddenLine("Supabase recovery management token: ");
  for (const value of [sourceAdministratorPassword, targetAdministratorPassword, managementToken]) {
    assertSecret(value);
  }
  return {
    caCertificate,
    managementToken,
    sourceAdministratorPassword,
    targetAdministratorPassword,
  };
}

function validateProcessArguments(command, arguments_, secretValues) {
  if (
    !fixedChildCommands.has(command) ||
    !Array.isArray(arguments_) ||
    arguments_.some(
      (value) =>
        typeof value !== "string" ||
        value.includes("\0") ||
        value.includes("\r") ||
        value.includes("\n"),
    )
  ) {
    fail();
  }
  for (const secret of secretValues) {
    assertSecret(secret);
    if (command.includes(secret) || arguments_.some((value) => value.includes(secret))) fail();
  }
}

export function runHostedRestoreDrillProcess(
  command,
  arguments_,
  {
    extraEnvironment = {},
    managementToken,
    maxOutputBytes = 4_096,
    secretValues = [],
    spawnProcess = spawn,
    timeoutMilliseconds = 300_000,
  } = {},
) {
  validateProcessArguments(command, arguments_, secretValues);
  if (
    extraEnvironment === null ||
    typeof extraEnvironment !== "object" ||
    Object.keys(extraEnvironment).length !== 0 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 1_048_576 ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 1_800_000
  ) {
    return Promise.reject(new Error("Hosted restore-drill process contract failed."));
  }
  if (managementToken !== undefined) {
    assertSecret(managementToken);
    if (!secretValues.includes(managementToken)) fail();
  }
  return new Promise((resolveResult) => {
    let stdout = "";
    let terminated = false;
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    let child;
    try {
      child = spawnProcess(command, arguments_, {
        env: {
          LANG: "C",
          LC_ALL: "C",
          ...(managementToken === undefined ? {} : { SUPABASE_ACCESS_TOKEN: managementToken }),
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      finish({ code: null, stdout: "" });
      return;
    }
    timer = setTimeout(() => {
      terminated = true;
      child.kill("SIGKILL");
    }, timeoutMilliseconds);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > maxOutputBytes) {
        terminated = true;
        stdout = "";
        child.kill("SIGKILL");
      } else if (!terminated) {
        stdout += chunk;
      }
    });
    child.once("error", () => finish({ code: null, stdout: "" }));
    child.once("close", (code, signal) => {
      const leaked = secretValues.some((secret) => stdout.includes(secret));
      finish({
        code: terminated || leaked || signal !== null ? null : code,
        stdout: terminated || leaked ? "" : stdout,
      });
    });
  });
}

function escapePgpass(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

function assertConnection(connection) {
  if (
    connection === null ||
    typeof connection !== "object" ||
    Object.keys(connection).sort().join(",") !== "database,host,port,user" ||
    [connection.database, connection.host, connection.port, connection.user].some(
      (value) =>
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > 255 ||
        /[\0\r\n]/u.test(value),
    )
  ) {
    fail();
  }
}

async function writePrivateFile(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function withHostedRestoreDrillDatabaseChannel({
  caCertificate,
  connection,
  password,
  run,
}) {
  assertConnection(connection);
  assertSecret(password);
  if (
    typeof caCertificate !== "string" ||
    Buffer.byteLength(caCertificate) > 32_768 ||
    !/^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\n$/u.test(caCertificate) ||
    typeof run !== "function"
  ) {
    fail();
  }
  const directory = await mkdtemp(join(tmpdir(), "huayi-hosted-restore-channel-"));
  await chmod(directory, 0o700);
  const caPath = join(directory, "root.crt");
  const pgpassPath = join(directory, ".pgpass");
  try {
    await writePrivateFile(caPath, caCertificate);
    const fields = [
      connection.host,
      connection.port,
      connection.database,
      connection.user,
      password,
    ];
    await writePrivateFile(pgpassPath, `${fields.map(escapePgpass).join(":")}\n`);
    return await run(Object.freeze({ caPath, directory, pgpassPath }));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function cleanupHostedRestoreDrillTarget({
  deleteTarget,
  expectedIdentityDigest,
  observedIdentityDigest,
  removeTemporaryArtifacts,
  revokeCredentials,
  verifyTargetAbsent,
}) {
  await removeTemporaryArtifacts();
  if (
    !digestPattern.test(expectedIdentityDigest) ||
    observedIdentityDigest !== expectedIdentityDigest
  ) {
    fail();
  }
  if ((await revokeCredentials()) !== true) fail();
  if ((await deleteTarget()) !== true) fail();
  if ((await verifyTargetAbsent()) !== true) fail();
  return {
    outboundArtifactsAbsent: true,
    targetAbsenceVerified: true,
    targetCredentialsRevoked: true,
    targetDeletionRequested: true,
    targetIdentityDigest: expectedIdentityDigest,
    temporaryArtifactsRemoved: true,
  };
}
