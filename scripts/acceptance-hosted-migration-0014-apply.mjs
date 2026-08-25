import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedAcceptanceMigrationVersions,
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  requireHostedCaCertificate,
  runHostedPsql,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import {
  hostedImportantBatchBackupPreflightArgument,
  runHostedImportantBatchBackupCli,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import {
  hostedMigration0014Filename,
  parseHostedMigration0014DryRunOutput,
  runHostedMigration0014DryRunProcess,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const failureMessage =
  "Hosted 0014 migration apply did not produce verified completion; do not retry until remote state is checked.";
const realCertificateIo = Object.freeze({ mkdtemp, rm, writeFile });
const migrationSourceSha256 = "2223d48e68a3d75f02a6fbc200d892ea347b2cac72680a48fd5dd56db7297faf";
const supabaseMigrationPath = join(
  repositoryRoot,
  "supabase",
  "migrations",
  "20260824010000_password_signup_otp_resend.sql",
);
const apiMigrationPath = join(
  repositoryRoot,
  "apps",
  "api",
  "migrations",
  "0014-password-signup-otp-resend.sql",
);

export const hostedMigration0014ApplyArgument = `--confirm-apply-20260824010000-password-signup-otp-resend-${hostedAcceptanceProjectRef}`;
export const hostedMigration0014ApplySuccessMessage = `Supabase migration applied and verified: exactly ${hostedMigration0014Filename}.`;

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
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}

export async function verifyHostedMigration0014RepositoryIdentity({
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
      throw new Error("Hosted 0014 migration repository identity is invalid.");
    }
    return true;
  } catch {
    throw new Error("Hosted 0014 migration repository identity is invalid.");
  }
}

async function runHostedMigration0014Preflight() {
  const code = await runHostedImportantBatchBackupCli({
    arguments_: [hostedImportantBatchBackupPreflightArgument],
    writeError: () => undefined,
    writeOutput: () => undefined,
  });
  if (code !== 0) return false;
  try {
    return await verifyHostedMigration0014RepositoryIdentity();
  } catch {
    return false;
  }
}

export async function runHostedMigration0014ApplyProcess(
  { administratorPassword, caCertificate },
  { certificateIo = realCertificateIo, spawnProcess = spawn, timeoutMilliseconds = 300_000 } = {},
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
            PGPASSWORD: administratorPassword,
            PGSSLMODE: "verify-full",
            PGSSLROOTCERT: rootCertificate,
          },
          shell: false,
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: true,
        });
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
  } finally {
    await certificateIo.rm(certificateDirectory, { force: true, recursive: true });
  }
}

export function renderHostedMigration0014PostflightSql() {
  const migrations = sqlTextArray(hostedAcceptanceMigrationVersions);
  return `
BEGIN READ ONLY;
SELECT CASE WHEN
  (SELECT array_agg(version::text ORDER BY version::text)
   FROM supabase_migrations.schema_migrations) = ${migrations}
  AND (SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'invitation_claims'
         AND column_name = 'bound_email'
         AND data_type = 'text'
         AND udt_schema = 'pg_catalog'
         AND udt_name = 'text'
         AND column_default IS NULL
         AND character_maximum_length IS NULL
         AND is_identity = 'NO'
         AND is_generated = 'NEVER'
         AND is_nullable = 'YES') = 1
  AND (
    SELECT count(*) = 1
    FROM pg_constraint target_constraint
    WHERE target_constraint.conrelid = 'public.invitation_claims'::regclass
      AND target_constraint.contype = 'c'
      AND target_constraint.conname = 'invitation_claims_bound_email_check'
      AND target_constraint.conkey = ARRAY[(
        SELECT target_column.attnum
        FROM pg_attribute target_column
        WHERE target_column.attrelid = 'public.invitation_claims'::regclass
          AND target_column.attname = 'bound_email'
          AND NOT target_column.attisdropped
      )]::smallint[]
      AND pg_get_expr(target_constraint.conbin, target_constraint.conrelid) =
        '((bound_email IS NULL) OR (bound_email = lower(bound_email)))'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.oid = to_regprocedure('public.bind_auth_identity(text,uuid)')
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND position('bound_email' IN pg_get_functiondef(procedure.oid)) > 0
  )
  AND EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.oid = to_regprocedure(
        'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
      )
      AND procedure.pronargs = 3
      AND procedure.proargnames = ARRAY[
        'invitation_token_hash',
        'new_flow_hash',
        'new_expires_at',
        'account_email'
      ]::text[]
      AND procedure.proargmodes = ARRAY['i', 'i', 'i', 't']::"char"[]
      AND procedure.proallargtypes = ARRAY[
        'text'::regtype::oid,
        'text'::regtype::oid,
        'timestamptz'::regtype::oid,
        'text'::regtype::oid
      ]::oid[]
      AND procedure.proretset
      AND procedure.prorettype = 'record'::regtype
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
  )
  AND has_function_privilege(
    'huayi_context_setter',
    'public.renew_interrupted_password_confirmation(text,text,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'huayi_business',
    'public.renew_interrupted_password_confirmation(text,text,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'huayi_runtime',
    'public.renew_interrupted_password_confirmation(text,text,timestamptz)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure,
         LATERAL aclexplode(
           COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
         ) privilege
    WHERE procedure.oid = to_regprocedure(
      'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
    )
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  )
  AND (
    SELECT count(*) = 2
      AND count(*) FILTER (
        WHERE privilege.grantee = procedure.proowner
          AND privilege.is_grantable IS FALSE
      ) = 1
      AND count(*) FILTER (
        WHERE privilege.grantee = (
          SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'
        )
          AND privilege.is_grantable IS FALSE
      ) = 1
    FROM pg_proc procedure,
         LATERAL aclexplode(
           COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
         ) privilege
    WHERE procedure.oid = to_regprocedure(
      'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
    )
      AND privilege.privilege_type = 'EXECUTE'
  )
THEN 't' ELSE 'f' END;
ROLLBACK;
`;
}

export function parseHostedMigration0014PostflightOutput(output) {
  return output === "t\n";
}

async function runHostedMigration0014Postflight({ administratorPassword, caCertificate }) {
  const result = await runHostedPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
      PGPASSWORD: administratorPassword,
    },
    input: renderHostedMigration0014PostflightSql(),
  });
  return result.code === 0 && parseHostedMigration0014PostflightOutput(result.stdout);
}

export async function runHostedMigration0014ApplyCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runApply = runHostedMigration0014ApplyProcess,
  runDryRun = runHostedMigration0014DryRunProcess,
  runPostflight = runHostedMigration0014Postflight,
  runPreflight = runHostedMigration0014Preflight,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0014ApplyArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) throw new Error(failureMessage);
    const secrets = { administratorPassword, caCertificate };
    const dryRun = await runDryRun(secrets);
    if (
      dryRun.code !== 0 ||
      dryRun.stdout !== "" ||
      !parseHostedMigration0014DryRunOutput(dryRun.stderr)
    ) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    const apply = await runApply(secrets);
    if (apply.code !== 0 || (await runPostflight(secrets)) !== true) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0014ApplySuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0014ApplyCli();
}
