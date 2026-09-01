import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  renderHostedPgpass,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  hostedMigration0015Filename,
  hasExactHostedMigration0015DryRunTranscript,
  runHostedMigration0015DryRunProcess,
} from "./acceptance-hosted-migration-0015-dry-run.mjs";
import { runHostedMigration0015StatusQuery } from "./acceptance-hosted-migration-0015-status.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import {
  hostedPhase91BackupPreflightArgument,
  runHostedPhase91BackupCli,
} from "./acceptance-hosted-phase-91-backup.mjs";
import { withHostedSignalAwareCleanup } from "./acceptance-hosted-signal-aware-cleanup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const failureMessage =
  "Hosted 0015 migration apply did not produce verified completion; do not retry until remote state is checked.";
const realCertificateIo = Object.freeze({ chmod, mkdtemp, rm, writeFile });
const migrationSourceSha256 = "a9f17524dfecb4bbf47ffc954e56bb1d3629fe2cd175a0b17af5b47b32d98634";
const supabaseMigrationPath = join(
  repositoryRoot,
  "supabase",
  "migrations",
  hostedMigration0015Filename,
);
const apiMigrationPath = join(
  repositoryRoot,
  "apps",
  "api",
  "migrations",
  "0015-public-function-acl-hardening.sql",
);

export const hostedMigration0015ApplyArgument = `--confirm-apply-20260825010000-public-function-acl-hardening-${hostedAcceptanceProjectRef}`;
export const hostedMigration0015ApplySuccessMessage = `Supabase migration applied and verified: exactly ${hostedMigration0015Filename}.`;

const fixedSupabaseArguments = Object.freeze([
  "db",
  "push",
  "--yes",
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
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    return false;
  } catch {
    return true;
  }
}

export async function verifyHostedMigration0015RepositoryIdentity({
  readMigrationFile = readFile,
} = {}) {
  try {
    const [supabaseMigration, apiMigration] = await Promise.all([
      readMigrationFile(supabaseMigrationPath),
      readMigrationFile(apiMigrationPath),
    ]);
    if (
      !Buffer.isBuffer(supabaseMigration) ||
      !Buffer.isBuffer(apiMigration) ||
      !supabaseMigration.equals(apiMigration) ||
      createHash("sha256").update(supabaseMigration).digest("hex") !== migrationSourceSha256
    ) {
      throw new Error("Hosted 0015 migration repository identity is invalid.");
    }
    return true;
  } catch {
    throw new Error("Hosted 0015 migration repository identity is invalid.");
  }
}

export async function runHostedMigration0015Preflight() {
  const code = await runHostedPhase91BackupCli({
    arguments_: [hostedPhase91BackupPreflightArgument],
    writeError: () => undefined,
    writeOutput: () => undefined,
  });
  if (code !== 0) return false;
  try {
    return await verifyHostedMigration0015RepositoryIdentity();
  } catch {
    return false;
  }
}

export async function runHostedMigration0015ApplyProcess(
  { administratorPassword, caCertificate },
  {
    certificateIo = realCertificateIo,
    process_ = process,
    spawnProcess = spawn,
    timeoutMilliseconds = 300_000,
  } = {},
) {
  const certificate = requireHostedCaCertificate({
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  });
  const certificateDirectory = await certificateIo.mkdtemp(join(tmpdir(), "huayi-hosted-0015-ca-"));
  const rootCertificate = join(certificateDirectory, "root.crt");
  const passwordFile = join(certificateDirectory, ".pgpass");
  return withHostedSignalAwareCleanup({
    cleanup: () => certificateIo.rm(certificateDirectory, { force: true, recursive: true }),
    process_,
    run: async ({ registerChild }) => {
      await certificateIo.chmod(certificateDirectory, 0o700);
      await certificateIo.writeFile(rootCertificate, certificate, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await certificateIo.writeFile(
        passwordFile,
        `${renderHostedPgpass(hostedAcceptancePoolerUrl, administratorPassword)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      return new Promise((resolveResult) => {
        let settled = false;
        let timedOut = false;
        let timeout;
        const finish = (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolveResult({ code });
        };
        let child;
        try {
          child = spawnProcess(supabaseCommand, fixedSupabaseArguments, {
            cwd: repositoryRoot,
            env: {
              LANG: "C",
              LC_ALL: "C",
              PGPASSFILE: passwordFile,
              PGSSLMODE: "verify-full",
              PGSSLROOTCERT: rootCertificate,
            },
            shell: false,
            stdio: ["ignore", "ignore", "ignore"],
            windowsHide: true,
          });
          registerChild(child);
        } catch {
          finish(null);
          return;
        }
        timeout = setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGKILL");
          } catch {
            finish(null);
          }
        }, timeoutMilliseconds);
        child.once("error", () => finish(null));
        child.once("close", (code, signal) => {
          finish(timedOut || signal !== null ? null : code);
        });
      });
    },
  });
}

export async function runHostedMigration0015Postflight(
  secrets,
  { runStatusQuery = runHostedMigration0015StatusQuery } = {},
) {
  try {
    return (await runStatusQuery(secrets)) === "applied_exact";
  } catch {
    return false;
  }
}

export async function runHostedMigration0015ApplyCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runApply = runHostedMigration0015ApplyProcess,
  runDryRun = runHostedMigration0015DryRunProcess,
  runPostflight = runHostedMigration0015Postflight,
  runPreflight = runHostedMigration0015Preflight,
  runStatus = runHostedMigration0015StatusQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0015ApplyArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword({ environment });
    if (!passwordIsValid(administratorPassword)) throw new Error(failureMessage);
    const secrets = { administratorPassword, caCertificate };
    const dryRun = await runDryRun(secrets);
    if (dryRun.code !== 0 || !hasExactHostedMigration0015DryRunTranscript(dryRun)) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    if ((await runStatus(secrets)) !== "pending_exact") throw new Error(failureMessage);
    const apply = await runApply(secrets);
    if (apply.code !== 0 || (await runPostflight(secrets)) !== true) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0015ApplySuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0015ApplyCli();
}
