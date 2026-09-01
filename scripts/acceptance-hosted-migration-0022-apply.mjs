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
  hasExactHostedMigration0022DryRunTranscript,
  hostedMigration0022Filename,
  runHostedMigration0022DryRunProcess,
  verifyHostedMigration0022SupabaseCli,
} from "./acceptance-hosted-migration-0022-dry-run.mjs";
import { runHostedMigration0022StatusQuery } from "./acceptance-hosted-migration-0022-status.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import {
  hostedPhase92MigrationBackupPreflightArgument,
  runHostedPhase92MigrationBackupCli,
} from "./acceptance-hosted-phase-92-migration-backup.mjs";
import { withHostedSignalAwareCleanup } from "./acceptance-hosted-signal-aware-cleanup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const failureMessage =
  "Hosted 0022 migration apply did not produce verified completion; do not retry until remote state is checked.";
const realCertificateIo = Object.freeze({ chmod, mkdtemp, rm, writeFile });
const migrationSourceSha256 = "a491e56ba3905ada4f5eb50ce152a08b6f534bc4f479de6fca6601a977ddd5d5";
const supabaseMigrationPath = join(
  repositoryRoot,
  "supabase",
  "migrations",
  hostedMigration0022Filename,
);
const apiMigrationPath = join(
  repositoryRoot,
  "apps",
  "api",
  "migrations",
  "0022-password-signup-expired-invitation-recovery.sql",
);

export const hostedMigration0022ApplyArgument = `--confirm-apply-20260828010000-password-signup-expired-invitation-recovery-${hostedAcceptanceProjectRef}`;
export const hostedMigration0022ApplySuccessMessage = `Supabase migration applied and verified: exactly ${hostedMigration0022Filename}.`;

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
    Buffer.byteLength(password) >= 12 &&
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

export async function verifyHostedMigration0022RepositoryIdentity({
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
      throw new Error("Hosted 0022 migration repository identity is invalid.");
    }
    return true;
  } catch {
    throw new Error("Hosted 0022 migration repository identity is invalid.");
  }
}

export async function runHostedMigration0022Preflight({
  runBackupCli = runHostedPhase92MigrationBackupCli,
  verifyRepositoryIdentity = verifyHostedMigration0022RepositoryIdentity,
  verifySupabaseCli = verifyHostedMigration0022SupabaseCli,
} = {}) {
  const code = await runBackupCli({
    arguments_: [hostedPhase92MigrationBackupPreflightArgument],
    writeError: () => undefined,
    writeOutput: () => undefined,
  });
  if (code !== 0) return false;
  try {
    if ((await verifyRepositoryIdentity()) !== true) return false;
    return (await verifySupabaseCli()) === true;
  } catch {
    return false;
  }
}

export async function runHostedMigration0022ApplyProcess(
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
  const certificateDirectory = await certificateIo.mkdtemp(join(tmpdir(), "huayi-hosted-0022-ca-"));
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
        let invalidResult = false;
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
              SUPABASE_NO_UPDATE_NOTIFIER: "1",
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
        const terminate = () => {
          invalidResult = true;
          try {
            child.kill("SIGKILL");
          } catch {
            // The process may already have exited; the fixed failure result still wins.
          }
          finish(null);
        };
        timeout = setTimeout(terminate, timeoutMilliseconds);
        child.once("error", () => finish(null));
        child.once("close", (code, signal) => {
          finish(invalidResult || signal !== null ? null : code);
        });
      });
    },
  });
}

export async function runHostedMigration0022Postflight(
  secrets,
  { runStatusQuery = runHostedMigration0022StatusQuery } = {},
) {
  try {
    return (await runStatusQuery(secrets)) === "applied_exact";
  } catch {
    return false;
  }
}

export async function runHostedMigration0022ApplyCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runApply = runHostedMigration0022ApplyProcess,
  runDryRun = runHostedMigration0022DryRunProcess,
  runPostflight = runHostedMigration0022Postflight,
  runPreflight = runHostedMigration0022Preflight,
  runStatus = runHostedMigration0022StatusQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0022ApplyArgument ||
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
    if (dryRun.code !== 0 || !hasExactHostedMigration0022DryRunTranscript(dryRun)) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    if ((await runStatus(secrets)) !== "pending_exact") throw new Error(failureMessage);
    const apply = await runApply(secrets);
    if (apply.code !== 0 || (await runPostflight(secrets)) !== true) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0022ApplySuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0022ApplyCli();
}
