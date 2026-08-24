import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedAcceptanceCaCertificateUrl,
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const failureMessage = "Hosted 0014 migration dry-run failed closed; database was not modified.";
const realCertificateIo = Object.freeze({ mkdtemp, rm, writeFile });

export const hostedMigration0014Filename = "20260824010000_password_signup_otp_resend.sql";
export const hostedMigration0014DryRunArgument = `--confirm-dry-run-20260824010000-password-signup-otp-resend-${hostedAcceptanceProjectRef}`;
export const hostedMigration0014SuccessMessage = `Supabase migration dry-run passed: exactly ${hostedMigration0014Filename}; database was not modified.`;

const fixedSupabaseArguments = Object.freeze([
  "db",
  "push",
  "--dry-run",
  "--skip-vault",
  "--db-url",
  hostedAcceptancePoolerUrl,
]);

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) > 0 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

function environmentHasInheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}

export async function fetchHostedMigration0014CaCertificate({
  fetchImplementation = fetch,
  maxOutputBytes = 16_384,
  timeoutMilliseconds = 10_000,
} = {}) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMilliseconds);
  let reader;
  try {
    const response = await fetchImplementation(hostedAcceptanceCaCertificateUrl, {
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: abortController.signal,
    });
    if (
      response?.ok !== true ||
      response.status !== 200 ||
      response.url !== hostedAcceptanceCaCertificateUrl ||
      response.body === null ||
      typeof response.body?.getReader !== "function"
    ) {
      throw new Error("Hosted 0014 CA download failed.");
    }
    reader = response.body.getReader();
    const chunks = [];
    let outputBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error("Hosted 0014 CA download failed.");
      }
      outputBytes += value.byteLength;
      if (outputBytes > maxOutputBytes) {
        throw new Error("Hosted 0014 CA download failed.");
      }
      chunks.push(value);
    }
    const certificate = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, outputBytes),
    );
    if (
      !/^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n$/u.test(
        certificate,
      )
    ) {
      throw new Error("Hosted 0014 CA download failed.");
    }
    return requireHostedCaCertificate({
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: certificate,
    });
  } catch {
    throw new Error("Hosted 0014 CA download failed.");
  } finally {
    clearTimeout(timeout);
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        reader.releaseLock();
        reader = undefined;
      }
      reader?.releaseLock();
    }
  }
}

export function parseHostedMigration0014DryRunOutput(output) {
  if (typeof output !== "string") return false;
  const lines = output.split("\n");
  if (lines.length !== 6 || lines.at(-1) !== "") return false;
  return (
    lines[0] === "DRY RUN: migrations will *not* be pushed to the database." &&
    lines[1] === "Connecting to remote database..." &&
    lines[2] === "Would push these migrations:" &&
    /^(?: )?• 20260824010000_password_signup_otp_resend\.sql$/u.test(lines[3]) &&
    lines[4] === "Finished supabase db push."
  );
}

export async function runHostedMigration0014DryRunProcess(
  { administratorPassword, caCertificate },
  {
    certificateIo = realCertificateIo,
    maxOutputBytes = 131_072,
    spawnProcess = spawn,
    timeoutMilliseconds = 300_000,
  } = {},
) {
  const certificate = requireHostedCaCertificate({
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  });
  const certificateDirectory = await certificateIo.mkdtemp(join(tmpdir(), "huayi-hosted-0014-ca-"));
  const rootCertificate = join(certificateDirectory, "root.crt");
  try {
    await certificateIo.writeFile(rootCertificate, certificate, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return await new Promise((resolveResult) => {
      let settled = false;
      let stdout = "";
      let invalidResult = false;
      let timeout;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResult(result);
      };
      const child = spawnProcess(supabaseCommand, fixedSupabaseArguments, {
        cwd: repositoryRoot,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PGPASSWORD: administratorPassword,
          PGSSLMODE: "verify-full",
          PGSSLROOTCERT: rootCertificate,
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      timeout = setTimeout(() => {
        invalidResult = true;
        child.kill("SIGKILL");
      }, timeoutMilliseconds);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > maxOutputBytes) {
          invalidResult = true;
          stdout = "";
          child.kill("SIGKILL");
          return;
        }
        stdout += chunk;
      });
      child.once("error", () => finish({ code: null, stdout: "" }));
      child.once("close", (code, signal) => {
        finish({
          code: invalidResult || signal !== null ? null : code,
          stdout: invalidResult ? "" : stdout,
        });
      });
    });
  } finally {
    await certificateIo.rm(certificateDirectory, { force: true, recursive: true });
  }
}

export async function runHostedMigration0014DryRunCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedMigration0014CaCertificate,
  readPassword = readHiddenTerminalLine,
  runSupabase = runHostedMigration0014DryRunProcess,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0014DryRunArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    const password = await readPassword();
    if (!passwordIsValid(password)) throw new Error(failureMessage);
    const caCertificate = await fetchCaCertificate();
    const result = await runSupabase({ administratorPassword: password, caCertificate });
    if (result.code !== 0 || !parseHostedMigration0014DryRunOutput(result.stdout)) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0014SuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0014DryRunCli();
}
