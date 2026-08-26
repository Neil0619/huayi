import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationNames = [
  "0001-cloud-v1-foundation.sql",
  "0002-account-default-quota.sql",
  "0003-password-auth-callback-method.sql",
  "0004-analysis-reservation-fallback.sql",
  "0005-practice-generation-settlement.sql",
  "0006-owner-scoped-analysis-export.sql",
  "0007-analysis-export-owner-wrapper.sql",
  "0008-extension-pairing-atomic-snapshot.sql",
  "0009-account-deletion-replay.sql",
  "0010-quota-lifecycle-and-model-rate-limit.sql",
  "0011-security-notification-delivery.sql",
  "0012-first-operator-bootstrap.sql",
  "0013-password-signup-interruption-recovery.sql",
  "0014-password-signup-otp-resend.sql",
  "0015-public-function-acl-hardening.sql",
  "0016-hosted-deepseek-acceptance-authority.sql",
  "0017-hosted-deepseek-acceptance-retention-scrub.sql",
  "0018-hosted-deepseek-acceptance-status.sql",
];
const migrationUrls = migrationNames.map(
  (name) => new URL(`../migrations/${name}`, import.meta.url),
);
const forwardUrl = new URL(
  "../migrations/0019-hosted-deepseek-acceptance-effective-fuse.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260827040000_hosted_deepseek_acceptance_effective_fuse.sql",
  import.meta.url,
);
const userId = "00000000-0000-4000-8000-000000000001";

function operationId(sequence: number): string {
  return `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

async function insertOperation(
  database: PGlite,
  sequence: number,
  state: "cleanup-pending" | "running",
  leaseInterval = "90 seconds",
): Promise<void> {
  const running = state === "running";
  await database.query(
    `
      INSERT INTO huayi_private.hosted_acceptance_operations (
        id, approval_digest, candidate_commit, maximum_reservation_micro_usd,
        payload_digest, api_deployment_id, api_source_commit,
        web_deployment_id, web_source_commit, state, lease_generation,
        lease_token_hash, lease_expires_at
      ) VALUES (
        $1, repeat($2, 64), repeat('a', 40), 50000,
        repeat('b', 64), 'dpl_apiAcceptance', repeat('c', 40),
        'dpl_webAcceptance', repeat('d', 40), $3, 1,
        $4::text,
        CASE WHEN $4::text IS NULL THEN NULL ELSE statement_timestamp() + $5::interval END
      )
    `,
    [
      operationId(sequence),
      String(sequence),
      state,
      running ? "e".repeat(64) : null,
      leaseInterval,
    ],
  );
  await database.query(
    `INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations(operation_id) VALUES ($1)`,
    [operationId(sequence)],
  );
}

async function reserve(database: PGlite, sequence: number): Promise<void> {
  await database.query(
    `SELECT public.reserve_quota($1, $2, $3, 1, statement_timestamp() + interval '2 minutes')`,
    [
      `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      userId,
      `30000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ],
  );
}

async function mutationCounts(database: PGlite): Promise<Record<string, number>> {
  const result = await database.query<{
    grants: number;
    rate_events: number;
    reservations: number;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM public.quota_grants) AS grants,
      (SELECT count(*)::integer FROM public.model_rate_limit_events) AS rate_events,
      (SELECT count(*)::integer FROM public.quota_reservations) AS reservations
  `);
  return result.rows[0] ?? {};
}

describe("Hosted DeepSeek acceptance effective-fuse migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    for (const migrationUrl of migrationUrls) {
      await database.exec(await readFile(migrationUrl, "utf8"));
    }
    await database.exec(`
      INSERT INTO public.user_profiles(user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userId}', '${userId}', 'fuse@example.test', 'active', 'UTC', 5);
      INSERT INTO public.runtime_controls(name, enabled)
      VALUES ('model_kill_switch', false);
    `);
    await database.exec(await readFile(forwardUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(
      await readFile(forwardUrl, "utf8"),
    );
  });

  it("allows only the physical-off state or a bounded live acceptance lease", async () => {
    await reserve(database, 1);
    await database.exec(`
      UPDATE public.quota_reservations SET status = 'released' WHERE status = 'active'
    `);

    await insertOperation(database, 1, "running", "120 seconds");
    await reserve(database, 2);

    await database.exec(`
      UPDATE public.runtime_controls SET enabled = true WHERE name = 'model_kill_switch'
    `);
    await expect(reserve(database, 3)).rejects.toThrow("model unavailable");
  });

  it("projects the same effective value to the operator without changing physical state", async () => {
    await database.exec(`
      INSERT INTO public.admin_roles(user_id, role) VALUES ('${userId}', 'operator');
    `);
    await insertOperation(database, 1, "cleanup-pending");
    const summary = await database.query<{ kill_switch_enabled: boolean }>(`
      SELECT kill_switch_enabled
      FROM public.admin_usage_summary(
        '${userId}', date_trunc('month', statement_timestamp()), statement_timestamp()
      )
    `);
    expect(summary.rows).toEqual([{ kill_switch_enabled: true }]);
    const physical = await database.query<{ enabled: boolean }>(`
      SELECT enabled FROM public.runtime_controls WHERE name = 'model_kill_switch'
    `);
    expect(physical.rows).toEqual([{ enabled: false }]);
  });

  it("fails closed after expiry or cleanup-pending with zero reservation-side mutation", async () => {
    await insertOperation(database, 1, "running", "-1 second");
    const beforeExpired = await mutationCounts(database);
    await expect(reserve(database, 1)).rejects.toThrow("model unavailable");
    expect(await mutationCounts(database)).toEqual(beforeExpired);

    await database.exec(`
      UPDATE huayi_private.hosted_acceptance_operations
      SET state = 'cleanup-pending', lease_token_hash = NULL, lease_expires_at = NULL,
          updated_at = statement_timestamp()
      WHERE id = '${operationId(1)}'
    `);
    const beforeCleanup = await mutationCounts(database);
    await expect(reserve(database, 2)).rejects.toThrow("model unavailable");
    expect(await mutationCounts(database)).toEqual(beforeCleanup);
  });

  it("fails closed for multiple otherwise live cleanup obligations", async () => {
    await insertOperation(database, 1, "running", "120 seconds");
    await database.exec(`DROP INDEX huayi_private.hosted_acceptance_one_non_terminal_operation`);
    await insertOperation(database, 2, "running", "120 seconds");

    const before = await mutationCounts(database);
    await expect(reserve(database, 1)).rejects.toThrow("model unavailable");
    expect(await mutationCounts(database)).toEqual(before);
  });

  it("fails closed for missing or corrupt control and authority state", async () => {
    await database.exec(`DELETE FROM public.runtime_controls`);
    await expect(reserve(database, 1)).rejects.toThrow("model unavailable");

    await database.exec(`
      INSERT INTO public.runtime_controls(name, enabled) VALUES ('model_kill_switch', false)
    `);
    await insertOperation(database, 1, "running", "10 minutes");
    await expect(reserve(database, 2)).rejects.toThrow("model unavailable");

    await database.exec(`
      UPDATE huayi_private.hosted_acceptance_cleanup_obligations
      SET state = 'completed', completed_at = statement_timestamp(),
          updated_at = statement_timestamp()
    `);
    await expect(reserve(database, 3)).rejects.toThrow("model unavailable");

    await database.exec(`
      ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations
        DROP CONSTRAINT hosted_acceptance_cleanup_obligations_state_check;
      ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations
        DROP CONSTRAINT hosted_acceptance_cleanup_claim_state_check;
      ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations
        DROP CONSTRAINT hosted_acceptance_cleanup_time_check;
      ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations
        DISABLE TRIGGER hosted_acceptance_cleanup_state_guard;
      UPDATE huayi_private.hosted_acceptance_cleanup_obligations SET state = 'unknown'
    `);
    await expect(reserve(database, 4)).rejects.toThrow("model unavailable");

    await database.exec(`
      ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations
        ALTER COLUMN state DROP NOT NULL;
      UPDATE huayi_private.hosted_acceptance_cleanup_obligations SET state = NULL
    `);
    await expect(reserve(database, 5)).rejects.toThrow("model unavailable");

    await database.exec(`
      ALTER TABLE public.runtime_controls ALTER COLUMN enabled DROP NOT NULL;
      UPDATE public.runtime_controls SET enabled = NULL;
    `);
    await expect(reserve(database, 6)).rejects.toThrow("model unavailable");
  });

  it("keeps the helper private and authority tables forced-RLS with zero direct access", async () => {
    const metadata = await database.query(`
      SELECT proname AS function_name, prosecdef AS security_definer,
        provolatile AS volatility, proconfig AS configuration
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE (namespace.nspname, procedure.proname) IN (
        ('huayi_private', 'effective_model_kill_switch_enabled'),
        ('public', 'admin_usage_summary'),
        ('public', 'reserve_quota')
      )
      ORDER BY CASE procedure.proname
        WHEN 'effective_model_kill_switch_enabled' THEN 0
        WHEN 'admin_usage_summary' THEN 1
        ELSE 2
      END
    `);
    expect(metadata.rows).toEqual([
      {
        configuration: ["search_path=pg_catalog, huayi_private"],
        function_name: "effective_model_kill_switch_enabled",
        security_definer: true,
        volatility: "s",
      },
      {
        configuration: ["search_path=pg_catalog"],
        function_name: "admin_usage_summary",
        security_definer: true,
        volatility: "v",
      },
      {
        configuration: ["search_path=pg_catalog"],
        function_name: "reserve_quota",
        security_definer: true,
        volatility: "v",
      },
    ]);

    const privileges = await database.query<{ can_execute: boolean; role_name: string }>(`
      SELECT role_name,
        has_function_privilege(
          role_name, 'huayi_private.effective_model_kill_switch_enabled()', 'EXECUTE'
        ) AS can_execute
      FROM unnest(ARRAY[
        'anon', 'authenticated', 'service_role', 'huayi_business',
        'huayi_context_setter', 'huayi_runtime', 'huayi_hosted_acceptance_executor'
      ]) role_name ORDER BY role_name
    `);
    expect(privileges.rows.every(({ can_execute }) => !can_execute)).toBe(true);

    const publicPrivileges = await database.query<{
      can_execute: boolean;
      function_name: string;
      role_name: string;
    }>(`
      SELECT role_name, function_name,
        has_function_privilege(role_name, function_name, 'EXECUTE') AS can_execute
      FROM unnest(ARRAY[
        'anon', 'authenticated', 'service_role', 'huayi_business',
        'huayi_context_setter', 'huayi_runtime', 'huayi_hosted_acceptance_executor'
      ]) role_name
      CROSS JOIN unnest(ARRAY[
        'public.admin_usage_summary(uuid,timestamptz,timestamptz)',
        'public.reserve_quota(uuid,uuid,uuid,bigint,timestamptz)'
      ]) function_name
    `);
    expect(
      publicPrivileges.rows.every(
        ({ can_execute, role_name }) => can_execute === (role_name === "huayi_context_setter"),
      ),
    ).toBe(true);

    const authority = await database.query<{ direct_access: boolean; force_rls: boolean }>(`
      SELECT relation.relforcerowsecurity AS force_rls,
        has_table_privilege(
          'huayi_hosted_acceptance_executor', relation.oid, 'SELECT,INSERT,UPDATE,DELETE'
        ) AS direct_access
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'huayi_private'
        AND relation.relname IN (
          'hosted_acceptance_operations', 'hosted_acceptance_cleanup_obligations'
        )
    `);
    expect(authority.rows).toHaveLength(2);
    expect(
      authority.rows.every(({ direct_access, force_rls }) => force_rls && !direct_access),
    ).toBe(true);
  });
});
