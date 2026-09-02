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
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { renderHostedRoleMembershipContractSql } from "./acceptance-hosted-role-memberships.mjs";

export const hostedVerificationArgument = `--verify-hosted-foundation-${hostedAcceptanceProjectRef}`;

export function renderHostedVerificationSql() {
  const migrations = sqlTextArray(hostedAcceptanceMigrationVersions);
  const tenantTables = sqlTextArray(hostedAcceptanceTenantTables);
  const { legacy, offPeak, peak } = hostedAcceptancePriceVersionIds;
  const roleMembershipContract = renderHostedRoleMembershipContractSql();
  return `
SELECT
  (SELECT array_agg(version::text ORDER BY version::text)
   FROM supabase_migrations.schema_migrations) = ${migrations}
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r') = 42
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'huayi_private'
         AND c.relname IN ('transaction_owner_context','first_operator_bootstrap')
         AND c.relkind = 'r') = 2
  AND (SELECT count(*) FROM pg_roles
       WHERE rolname = ANY(ARRAY['huayi_business','huayi_context_setter','huayi_runtime'])
         AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls
         AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) = 3
  AND pg_has_role('huayi_runtime', 'huayi_business', 'member')
  AND pg_has_role('huayi_runtime', 'huayi_context_setter', 'member')
  AND (SELECT count(*) FROM pg_roles
       WHERE rolname = '${hostedAcceptanceApplicationRole}' AND rolcanlogin
         AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls
         AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) = 1
  AND pg_has_role('${hostedAcceptanceApplicationRole}', 'huayi_runtime', 'member')
  AND (${roleMembershipContract})
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY(${tenantTables})
         AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
         AND EXISTS (
           SELECT 1 FROM pg_policy p
           WHERE p.polrelid = c.oid AND p.polname = c.relname || '_owner'
         )) = ${hostedAcceptanceTenantTables.length}
  AND (SELECT count(*) FROM public.model_price_versions
       WHERE (id, provider, model, input_micro_usd_per_million,
              cached_input_micro_usd_per_million, output_micro_usd_per_million,
              effective_from) IN (
         ('${legacy}', 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000,
          '2026-08-16T15:59:59Z'::timestamptz),
         ('${offPeak}', 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000,
          '2026-08-16T16:00:00Z'::timestamptz),
         ('${peak}', 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000,
          '2026-08-16T16:00:01Z'::timestamptz)
       )) = 3
  AND (SELECT count(*) FROM public.model_price_versions) = 3
  AND (SELECT enabled FROM public.runtime_controls WHERE name = 'model_kill_switch') = true
  AND (SELECT count(*) FROM public.runtime_controls) = 1
  AND (SELECT count(*) FROM storage.buckets
       WHERE id = '${hostedAcceptanceExportBucket}'
         AND name = '${hostedAcceptanceExportBucket}' AND public = false) = 1
  AND (SELECT count(*) FROM storage.buckets) = 1
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id = '${hostedAcceptanceExportBucket}') = 0
  AND (SELECT count(*) FROM storage.objects) = 0
  AND (SELECT count(*) FROM auth.users) = 0
  AND (SELECT count(*) FROM auth.identities) = 0
  AND (SELECT count(*) FROM public.user_profiles) = 0
  AND (SELECT count(*) FROM public.admin_roles) = 0
  AND (SELECT count(*) FROM public.invitations) = 0
  AND (SELECT count(*) FROM huayi_private.first_operator_bootstrap) = 0;
`;
}

export async function verifyHostedAcceptance({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedVerificationArgument) {
    throw new Error("Hosted acceptance verification arguments are invalid.");
  }
  rejectLegacyHostedCredentialEnvironment(environment);
  const caCertificate = await fetchCaCertificate();
  const password = await readCredential("supabase-admin-db-password", { environment });
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedVerificationSql(),
    password,
  });
  if (result.code !== 0 || result.stdout.trim() !== "t") {
    throw new Error("Hosted acceptance foundation verification failed.");
  }
  return true;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHostedAcceptance()
    .then(() => process.stdout.write("Hosted acceptance foundation verification passed.\n"))
    .catch(() => {
      process.stderr.write("Hosted acceptance foundation verification failed.\n");
      process.exitCode = 1;
    });
}
