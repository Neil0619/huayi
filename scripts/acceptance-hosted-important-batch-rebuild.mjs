import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveLocalDockerInspectionTarget } from "./acceptance-local-docker-inspection.mjs";
import { persistHostedImportantBatchRebuild } from "./acceptance-hosted-important-batch-artifacts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  assertFixedLocalDockerTarget,
  hostedImportantBatchMigrationVersions,
  hostedImportantBatchPostgresRuntimeReference,
  hostedImportantBatchScratchContainer,
  inspectHostedImportantBatchContainer,
  isHostedImportantBatchContainerAbsent,
  runHostedImportantBatchProcess,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";

export const hostedImportantBatchRebuildArgument = `--confirm-rebuild-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;

const migrationFiles = Object.freeze([
  "20260821000000_cloud_v1_foundation.sql",
  "20260821010000_account_default_quota.sql",
  "20260821020000_password_auth_callback_method.sql",
  "20260821030000_analysis_reservation_fallback.sql",
  "20260821040000_practice_generation_settlement.sql",
  "20260821050000_owner_scoped_analysis_export.sql",
  "20260821060000_analysis_export_owner_wrapper.sql",
  "20260821070000_extension_pairing_atomic_snapshot.sql",
  "20260821080000_account_deletion_replay.sql",
  "20260822010000_quota_lifecycle_and_model_rate_limit.sql",
  "20260822020000_security_notification_delivery.sql",
  "20260822030000_first_operator_bootstrap.sql",
  "20260823010000_password_signup_interruption_recovery.sql",
  "20260824010000_password_signup_otp_resend.sql",
]);
const seedSha256 = "6defe22d5e21ef4d98f77e2192c1c4c0ad96ec73c964ab897e9a1a63b8003050";
const fictionalUserId = "00000000-0000-4000-8000-000000000047";
const fictionalEmail = "local-acceptance-operator@seen-said.localhost";

const baselineSql = `/* baseline_contract */
SELECT 'baseline_contract|' || CASE WHEN
  to_regclass('auth.users') IS NOT NULL
  AND to_regclass('auth.identities') IS NOT NULL
  AND to_regclass('storage.objects') IS NOT NULL
  AND to_regclass('storage.buckets') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin')
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin')
THEN 't' ELSE 'f' END;
`;

const migrationLedgerSql = `/* migration_ledger_contract */
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[] NOT NULL DEFAULT ARRAY[]::text[],
  name text
);
DO $$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 0 THEN
    RAISE EXCEPTION 'scratch migration ledger is not empty';
  END IF;
END;
$$;
`;

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function finalContractSql() {
  const expectedVersions = hostedImportantBatchMigrationVersions
    .map((version) => `(${sqlLiteral(version)})`)
    .join(",");
  return `/* rebuild_contract */
WITH expected(version) AS (VALUES ${expectedVersions})
SELECT 'migration_chain_exact|' || CASE WHEN
  (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations) =
  (SELECT array_agg(version ORDER BY version) FROM expected)
THEN 't' ELSE 'f' END;
SELECT 'fictional_seed_exact|' || CASE WHEN
  (SELECT count(*) FROM public.user_profiles) = 1
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = '${fictionalUserId}' AND owner_user_id = '${fictionalUserId}'
      AND email = '${fictionalEmail}' AND status = 'active'
  )
  AND (SELECT count(*) FROM public.admin_roles) = 1
  AND EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = '${fictionalUserId}' AND role = 'operator'
  )
THEN 't' ELSE 'f' END;
SELECT 'hosted_data_absent|' || CASE WHEN
  (SELECT count(*) FROM auth.users) = 0
  AND (SELECT count(*) FROM auth.identities) = 0
  AND (SELECT count(*) FROM storage.objects) = 0
  AND (SELECT count(*) FROM public.invitations) = 0
  AND (SELECT count(*) FROM public.invitation_claims) = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id <> '${fictionalUserId}' OR email <> '${fictionalEmail}'
  )
THEN 't' ELSE 'f' END;
SELECT 'runtime_contract_exact|' || CASE WHEN
  to_regprocedure('public.renew_interrupted_password_confirmation(text,text,timestamptz)') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_runtime')
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_business')
THEN 't' ELSE 'f' END;
`;
}

async function assertRegularBoundedFile(path, maximumBytes) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.size < 1 || stats.size > maximumBytes) {
    throw new Error("Hosted important-batch rebuild source is invalid.");
  }
}

export async function loadHostedImportantBatchRebuildSources(repositoryRoot) {
  const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
  const actualFiles = (await readdir(migrationsRoot)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(migrationFiles)) {
    throw new Error("Hosted important-batch migration source set is invalid.");
  }
  const migrations = [];
  for (const [index, file] of migrationFiles.entries()) {
    const path = join(migrationsRoot, file);
    await assertRegularBoundedFile(path, 1_048_576);
    migrations.push({
      source: await readFile(path, "utf8"),
      version: hostedImportantBatchMigrationVersions[index],
    });
  }
  const seedPath = join(repositoryRoot, "supabase", "seed.sql");
  await assertRegularBoundedFile(seedPath, 65_536);
  const seed = await readFile(seedPath, "utf8");
  if (createHash("sha256").update(seed).digest("hex") !== seedSha256) {
    throw new Error("Hosted important-batch fictional seed is invalid.");
  }
  return { migrations, seed };
}

function assertExactSources(sources) {
  if (
    sources === null ||
    typeof sources !== "object" ||
    !Array.isArray(sources.migrations) ||
    sources.migrations.length !== hostedImportantBatchMigrationVersions.length ||
    typeof sources.seed !== "string" ||
    sources.seed.length === 0
  ) {
    throw new Error("Hosted important-batch rebuild sources are invalid.");
  }
  for (const [index, migration] of sources.migrations.entries()) {
    if (
      migration?.version !== hostedImportantBatchMigrationVersions[index] ||
      typeof migration.source !== "string" ||
      migration.source.length === 0
    ) {
      throw new Error("Hosted important-batch rebuild sources are invalid.");
    }
  }
}

function dockerArguments(target, tail) {
  assertFixedLocalDockerTarget(target);
  return ["--host", target.host, ...tail];
}

function psqlExecArguments() {
  return [
    "exec",
    "-i",
    hostedImportantBatchScratchContainer,
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
  ];
}

async function inspectScratch(dockerTarget, runProcess) {
  return inspectHostedImportantBatchContainer(
    dockerTarget,
    hostedImportantBatchScratchContainer,
    runProcess,
  );
}

async function startScratch(dockerTarget, runProcess) {
  const result = await runProcess(
    dockerTarget.command,
    dockerArguments(dockerTarget, [
      "run",
      "--detach",
      "--rm",
      "--pull",
      "never",
      "--name",
      hostedImportantBatchScratchContainer,
      "--label",
      "com.seen-said.acceptance=phase-81-0014-rebuild",
      "--network",
      "none",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--env",
      "POSTGRES_DB=postgres",
      hostedImportantBatchPostgresRuntimeReference,
    ]),
    { maxOutputBytes: 256 },
  );
  return result;
}

function scratchRuntimeIsExact(source) {
  try {
    const inspected = JSON.parse(source);
    return (
      inspected?.Config?.Image === hostedImportantBatchPostgresRuntimeReference &&
      inspected?.Config?.Labels?.["com.seen-said.acceptance"] === "phase-81-0014-rebuild" &&
      inspected?.HostConfig?.NetworkMode === "none" &&
      inspected?.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] ===
        "rw,nosuid,nodev,noexec,size=2147483648,mode=0700" &&
      (inspected?.HostConfig?.Binds === null || inspected?.HostConfig?.Binds?.length === 0) &&
      Array.isArray(inspected?.Mounts) &&
      inspected.Mounts.length === 0
    );
  } catch {
    return false;
  }
}

async function waitForScratch(dockerTarget, runProcess, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await runProcess(
      dockerTarget.command,
      dockerArguments(dockerTarget, [
        "exec",
        hostedImportantBatchScratchContainer,
        "pg_isready",
        "--quiet",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
      ]),
      { maxOutputBytes: 1, timeoutMilliseconds: 5_000 },
    );
    if (ready.code === 0 && ready.stdout === "") return;
    await wait(250);
  }
  throw new Error("Hosted important-batch scratch readiness failed.");
}

async function runSql(dockerTarget, runProcess, input, expectedOutput = "") {
  const result = await runProcess(
    dockerTarget.command,
    dockerArguments(dockerTarget, psqlExecArguments()),
    { input, maxOutputBytes: 4_096 },
  );
  if (result.code !== 0 || result.stdout !== expectedOutput) {
    throw new Error("Hosted important-batch scratch SQL failed.");
  }
}

function recordedMigrationSource(migration) {
  return `${migration.source}\nINSERT INTO supabase_migrations.schema_migrations (
  version, statements, name
) VALUES (
  ${sqlLiteral(migration.version)}, ARRAY[]::text[], ${sqlLiteral(migration.version)}
);\n`;
}

async function destroyScratch(dockerTarget, runProcess, wait, waitForLateAppearance) {
  return settleHostedImportantBatchContainer({
    dockerTarget,
    name: hostedImportantBatchScratchContainer,
    runProcess,
    runtimeIsExact: scratchRuntimeIsExact,
    wait,
    waitForLateAppearance,
  });
}

export async function rebuildHostedImportantBatchScratch({
  candidateCommit,
  loadSources = () => loadHostedImportantBatchRebuildSources(repositoryRoot),
  repositoryRoot,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runProcess = runHostedImportantBatchProcess,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
}) {
  const sources = await loadSources();
  assertExactSources(sources);
  const dockerTarget = await resolveDockerTarget();
  assertFixedLocalDockerTarget(dockerTarget);
  const existing = await inspectScratch(dockerTarget, runProcess);
  if (!isHostedImportantBatchContainerAbsent(existing)) {
    throw new Error("Hosted important-batch scratch identity is occupied.");
  }
  await persistHostedImportantBatchRebuild({
    candidateCommit,
    performRebuild: async () => {
      let cleanupRequired = false;
      let operationPassed = false;
      let scratchDestroyed = false;
      let waitForLateAppearance = false;
      try {
        cleanupRequired = true;
        let started;
        try {
          started = await startScratch(dockerTarget, runProcess);
        } catch (error) {
          waitForLateAppearance = true;
          throw error;
        }
        waitForLateAppearance = started.code === null;
        if (started.code !== 0) {
          throw new Error("Hosted important-batch scratch start failed.");
        }
        const inspected = await inspectScratch(dockerTarget, runProcess);
        if (inspected.code !== 0 || !scratchRuntimeIsExact(inspected.stdout)) {
          throw new Error("Hosted important-batch scratch runtime is invalid.");
        }
        await waitForScratch(dockerTarget, runProcess, wait);
        await runSql(dockerTarget, runProcess, baselineSql, "baseline_contract|t\n");
        await runSql(dockerTarget, runProcess, migrationLedgerSql);
        for (const migration of sources.migrations) {
          await runSql(dockerTarget, runProcess, recordedMigrationSource(migration));
        }
        await runSql(dockerTarget, runProcess, sources.seed);
        await runSql(
          dockerTarget,
          runProcess,
          finalContractSql(),
          "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
        );
        operationPassed = true;
      } catch {
        operationPassed = false;
      } finally {
        if (cleanupRequired) {
          scratchDestroyed = await destroyScratch(
            dockerTarget,
            runProcess,
            wait,
            waitForLateAppearance,
          );
        }
      }
      if (!operationPassed || !scratchDestroyed) {
        throw new Error("Hosted important-batch rebuild failed.");
      }
      return {
        fictionalSeedExact: true,
        hostedDataAbsent: true,
        migrationChainExact: true,
        runtimeContractExact: true,
        scratchDestroyed: true,
      };
    },
    repositoryRoot,
  });
}
