import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  hostedAcceptanceApplicationRole,
  hostedAcceptanceExportBucket,
  hostedAcceptanceMigrationVersions,
  hostedAcceptancePoolerUrl,
  hostedAcceptancePriceVersionIds,
  hostedAcceptanceProjectRef,
  hostedAcceptanceTenantTables,
  runHostedPsql,
  sqlLiteral,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { renderHostedRoleMembershipContractSql } from "./acceptance-hosted-role-memberships.mjs";

export const hostedBootstrapConfirmation = `--confirm-hosted-foundation-${hostedAcceptanceProjectRef}`;

function requireApplicationPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 32 ||
    password.length > 512 ||
    password.includes("\0")
  ) {
    throw new Error("Hosted acceptance application database password is unavailable.");
  }
  return password;
}

export function renderHostedBootstrapSql(applicationPassword) {
  const migrations = sqlTextArray(hostedAcceptanceMigrationVersions);
  const tenantTables = sqlTextArray(hostedAcceptanceTenantTables);
  const password = sqlLiteral(applicationPassword);
  const { legacy, offPeak, peak } = hostedAcceptancePriceVersionIds;
  const roleMembershipContract = renderHostedRoleMembershipContractSql();
  return `
BEGIN;

DO $hosted_preflight$
DECLARE
  actual_migrations text[];
  expected_migrations constant text[] := ${migrations};
  expected_tenant_tables constant text[] := ${tenantTables};
BEGIN
  IF current_user <> 'postgres'
     OR NOT COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Hosted acceptance bootstrap requires the project administrator.';
  END IF;

  SELECT array_agg(version::text ORDER BY version::text)
  INTO actual_migrations
  FROM supabase_migrations.schema_migrations;
  IF actual_migrations IS DISTINCT FROM expected_migrations THEN
    RAISE EXCEPTION 'Hosted acceptance migration history is not the approved 12-version chain.';
  END IF;

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r') <> 42
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'huayi_private'
           AND c.relname IN ('transaction_owner_context','first_operator_bootstrap')
           AND c.relkind = 'r') <> 2 THEN
    RAISE EXCEPTION 'Hosted acceptance schema is incomplete.';
  END IF;

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(expected_tenant_tables)
        AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
        AND EXISTS (
          SELECT 1 FROM pg_policy p
          WHERE p.polrelid = c.oid AND p.polname = c.relname || '_owner'
        )) <> cardinality(expected_tenant_tables) THEN
    RAISE EXCEPTION 'Hosted acceptance tenant RLS is incomplete.';
  END IF;

  IF (SELECT count(*) FROM pg_roles
      WHERE rolname = ANY(ARRAY['huayi_business','huayi_context_setter','huayi_runtime'])
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) <> 3
     OR NOT pg_has_role('huayi_runtime', 'huayi_business', 'member')
     OR NOT pg_has_role('huayi_runtime', 'huayi_context_setter', 'member') THEN
    RAISE EXCEPTION 'Hosted acceptance migration roles are unsafe.';
  END IF;

  IF (SELECT count(*) FROM auth.users) <> 0
     OR (SELECT count(*) FROM auth.identities) <> 0
     OR (SELECT count(*) FROM public.user_profiles) <> 0
     OR (SELECT count(*) FROM public.admin_roles) <> 0
     OR (SELECT count(*) FROM public.invitations) <> 0
     OR (SELECT count(*) FROM huayi_private.first_operator_bootstrap) <> 0
     OR NOT (
       ((SELECT count(*) FROM storage.buckets) = 0
        AND (SELECT count(*) FROM storage.objects) = 0)
       OR
       ((SELECT count(*) FROM storage.buckets) = 1
        AND (SELECT count(*) FROM storage.buckets
             WHERE id = '${hostedAcceptanceExportBucket}'
               AND name = '${hostedAcceptanceExportBucket}' AND public = false) = 1
        AND (SELECT count(*) FROM storage.objects) = 0)
     ) THEN
    RAISE EXCEPTION 'Hosted acceptance foundation requires an empty identity and storage state.';
  END IF;
END;
$hosted_preflight$;

DO $hosted_login$
DECLARE
  safe_role boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${hostedAcceptanceApplicationRole}') THEN
    CREATE ROLE ${hostedAcceptanceApplicationRole}
      LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
      PASSWORD ${password};
  ELSE
    SELECT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolpassword IS NOT NULL
    INTO safe_role
    FROM pg_roles
    WHERE rolname = '${hostedAcceptanceApplicationRole}';
    IF safe_role IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Hosted acceptance application role conflicts with the contract.';
    END IF;
  END IF;
END;
$hosted_login$;
GRANT huayi_runtime TO ${hostedAcceptanceApplicationRole};

DO $hosted_memberships$
BEGIN
  IF NOT (${roleMembershipContract}) THEN
    RAISE EXCEPTION 'Hosted acceptance role memberships conflict with the contract.';
  END IF;
END;
$hosted_memberships$;

INSERT INTO public.model_price_versions (
  id, provider, model, input_micro_usd_per_million,
  cached_input_micro_usd_per_million, output_micro_usd_per_million, effective_from
) VALUES
  ('${legacy}', 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000, '2026-08-16T15:59:59Z'),
  ('${offPeak}', 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000, '2026-08-16T16:00:00Z'),
  ('${peak}', 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000, '2026-08-16T16:00:01Z')
ON CONFLICT (id) DO NOTHING;

SELECT public.require_model_price_version(
  '${legacy}', 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000
);
SELECT public.require_model_price_version(
  '${offPeak}', 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000
);
SELECT public.require_model_price_version(
  '${peak}', 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000
);

INSERT INTO public.runtime_controls (name, enabled)
VALUES ('model_kill_switch', true)
ON CONFLICT (name) DO NOTHING;

DO $hosted_controls$
BEGIN
  IF (SELECT enabled FROM public.runtime_controls WHERE name = 'model_kill_switch')
     IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.runtime_controls) <> 1 THEN
    RAISE EXCEPTION 'Hosted acceptance kill switch must remain enabled.';
  END IF;
END;
$hosted_controls$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('${hostedAcceptanceExportBucket}', '${hostedAcceptanceExportBucket}', false)
ON CONFLICT (id) DO NOTHING;

DO $hosted_bucket$
BEGIN
  IF (SELECT count(*) FROM storage.buckets
      WHERE id = '${hostedAcceptanceExportBucket}'
        AND name = '${hostedAcceptanceExportBucket}' AND public = false) <> 1
     OR (SELECT count(*) FROM storage.buckets) <> 1
     OR (SELECT count(*) FROM storage.objects) <> 0
     OR (SELECT count(*) FROM public.model_price_versions) <> 3
     OR (SELECT count(*) FROM public.model_price_versions
         WHERE (id, provider, model, input_micro_usd_per_million,
                cached_input_micro_usd_per_million, output_micro_usd_per_million,
                effective_from) IN (
           ('${legacy}', 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000,
            '2026-08-16T15:59:59Z'::timestamptz),
           ('${offPeak}', 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000,
            '2026-08-16T16:00:00Z'::timestamptz),
           ('${peak}', 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000,
            '2026-08-16T16:00:01Z'::timestamptz)
         )) <> 3 THEN
    RAISE EXCEPTION 'Foundation bucket conflicts with the hosted acceptance contract.';
  END IF;
END;
$hosted_bucket$;

COMMIT;
`;
}

export async function bootstrapHostedAcceptance({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || !["--plan", hostedBootstrapConfirmation].includes(arguments_[0])) {
    throw new Error("Hosted acceptance bootstrap arguments are invalid.");
  }
  if (arguments_[0] === "--plan") return "planned";

  rejectLegacyHostedCredentialEnvironment(environment);
  const caCertificate = await fetchCaCertificate();
  const administratorPassword = await readCredential("supabase-admin-db-password", {
    environment,
  });
  const applicationPassword = requireApplicationPassword(
    await readCredential("supabase-application-db-password", { environment }),
  );
  const result = await runPsql({
    captureOutput: false,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedBootstrapSql(applicationPassword),
    password: administratorPassword,
  });
  if (result.code !== 0) throw new Error("Hosted acceptance foundation bootstrap failed.");
  return "applied";
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootstrapHostedAcceptance()
    .then((result) => {
      process.stdout.write(
        result === "planned"
          ? "Hosted acceptance foundation plan is ready; no remote changes were made.\n"
          : "Hosted acceptance foundation bootstrap completed.\n",
      );
    })
    .catch(() => {
      process.stderr.write("Hosted acceptance foundation bootstrap failed.\n");
      process.exitCode = 1;
    });
}
