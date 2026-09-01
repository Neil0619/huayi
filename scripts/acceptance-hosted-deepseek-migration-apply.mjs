import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedDeepseekMigrationBackupPreflightArgument,
  runHostedDeepseekMigrationBackupCli,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import {
  hasExactHostedDeepseekMigrationDryRunTranscript,
  hostedDeepseekMigrationFilenames,
  runHostedDeepseekMigrationDryRunProcess,
  verifyHostedDeepseekMigrationSupabaseCli,
} from "./acceptance-hosted-deepseek-migration-dry-run.mjs";
import { runHostedDeepseekMigrationStatusQuery } from "./acceptance-hosted-deepseek-migration-status.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  renderHostedPgpass,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { withHostedSignalAwareCleanup } from "./acceptance-hosted-signal-aware-cleanup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const failureMessage =
  "Hosted DeepSeek 0016-0021 migration apply did not produce verified completion; do not retry until remote state is checked.";
const realCertificateIo = Object.freeze({ chmod, mkdtemp, rm, writeFile });
const migrationIdentities = Object.freeze([
  [
    "0016-hosted-deepseek-acceptance-authority.sql",
    hostedDeepseekMigrationFilenames[0],
    "ac8dd4521e551be4b27002732ba924133d7f97e6f9a2f92f547d178a297d211c",
  ],
  [
    "0017-hosted-deepseek-acceptance-retention-scrub.sql",
    hostedDeepseekMigrationFilenames[1],
    "295e640f619bc14137e7f19c78df2bc76cb47259fc23e5cf7b1bffb3d073d9d1",
  ],
  [
    "0018-hosted-deepseek-acceptance-status.sql",
    hostedDeepseekMigrationFilenames[2],
    "b9bc2ac9c1fc96082ffcc45ad22349faba589a532dbaa9b9e15aac29702d5703",
  ],
  [
    "0019-hosted-deepseek-acceptance-effective-fuse.sql",
    hostedDeepseekMigrationFilenames[3],
    "f1d0599365b1437556673e9b37495b46653a053831487affd3a085303b8f7b56",
  ],
  [
    "0020-hosted-deepseek-acceptance-authority-mutations.sql",
    hostedDeepseekMigrationFilenames[4],
    "d4dbee773244985c9e5a3f55bcbb7f2e9ce03cc952342b82cbff0a775c7ba9db",
  ],
  [
    "0021-hosted-deepseek-acceptance-evidence.sql",
    hostedDeepseekMigrationFilenames[5],
    "1be7d36eb541a488e19b13a44b9ba3b3acf89165f9fb0f8f8c108a00d2e98d84",
  ],
]);

export const hostedDeepseekMigrationApplyArgument = `--confirm-apply-hosted-deepseek-0016-0021-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationApplySuccessMessage =
  "Supabase migrations applied and verified: exactly Hosted DeepSeek 0016-0021.";

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

export async function verifyHostedDeepseekMigrationRepositoryIdentity({
  readMigrationFile = readFile,
} = {}) {
  try {
    for (const [apiFilename, supabaseFilename, expectedSha256] of migrationIdentities) {
      const [apiMigration, supabaseMigration] = await Promise.all([
        readMigrationFile(join(repositoryRoot, "apps", "api", "migrations", apiFilename)),
        readMigrationFile(join(repositoryRoot, "supabase", "migrations", supabaseFilename)),
      ]);
      if (
        !Buffer.isBuffer(apiMigration) ||
        !Buffer.isBuffer(supabaseMigration) ||
        !apiMigration.equals(supabaseMigration) ||
        createHash("sha256").update(apiMigration).digest("hex") !== expectedSha256
      ) {
        throw new Error("Hosted DeepSeek migration repository identity is invalid.");
      }
    }
    return true;
  } catch {
    throw new Error("Hosted DeepSeek migration repository identity is invalid.");
  }
}

export async function runHostedDeepseekMigrationPreflight({
  runBackupCli = runHostedDeepseekMigrationBackupCli,
  verifyRepositoryIdentity = verifyHostedDeepseekMigrationRepositoryIdentity,
  verifySupabaseCli = verifyHostedDeepseekMigrationSupabaseCli,
} = {}) {
  const code = await runBackupCli({
    arguments_: [hostedDeepseekMigrationBackupPreflightArgument],
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

export async function runHostedDeepseekMigrationApplyProcess(
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
  const certificateDirectory = await certificateIo.mkdtemp(
    join(tmpdir(), "huayi-hosted-deepseek-migrations-ca-"),
  );
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

export async function runHostedDeepseekMigrationPostflight(
  secrets,
  { runStatusQuery = runHostedDeepseekMigrationStatusQuery } = {},
) {
  try {
    return (await runStatusQuery(secrets)) === "applied_exact";
  } catch {
    return false;
  }
}

export async function runHostedDeepseekMigrationApplyCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runApply = runHostedDeepseekMigrationApplyProcess,
  runDryRun = runHostedDeepseekMigrationDryRunProcess,
  runPostflight = runHostedDeepseekMigrationPostflight,
  runPreflight = runHostedDeepseekMigrationPreflight,
  runStatus = runHostedDeepseekMigrationStatusQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedDeepseekMigrationApplyArgument ||
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
    if (dryRun.code !== 0 || !hasExactHostedDeepseekMigrationDryRunTranscript(dryRun)) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    if ((await runStatus(secrets)) !== "pending_exact") throw new Error(failureMessage);
    const apply = await runApply(secrets);
    if (apply.code !== 0 || (await runPostflight(secrets)) !== true) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedDeepseekMigrationApplySuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationApplyCli();
}
