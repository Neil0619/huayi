import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const authorityUrl = new URL(
  "../migrations/0016-hosted-deepseek-acceptance-authority.sql",
  import.meta.url,
);
const retentionUrl = new URL(
  "../migrations/0017-hosted-deepseek-acceptance-retention-scrub.sql",
  import.meta.url,
);
const forwardUrl = new URL(
  "../migrations/0018-hosted-deepseek-acceptance-status.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260827030000_hosted_deepseek_acceptance_status.sql",
  import.meta.url,
);

function operationId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

async function insertReadyOperation(database: PGlite, sequence: number): Promise<void> {
  await database.query(
    `
      INSERT INTO huayi_private.hosted_acceptance_operations (
        id,
        approval_digest,
        candidate_commit,
        maximum_reservation_micro_usd,
        payload_digest,
        api_deployment_id,
        api_source_commit,
        web_deployment_id,
        web_source_commit
      ) VALUES (
        $1,
        repeat($2, 64),
        repeat('a', 40),
        50000,
        repeat('b', 64),
        'dpl_apiAcceptance',
        repeat('c', 40),
        'dpl_webAcceptance',
        repeat('d', 40)
      )
    `,
    [operationId(sequence), String(sequence)],
  );
}

async function readStatus(database: PGlite): Promise<string> {
  const result = await database.query<{ state: string }>(`
    SELECT huayi_private.read_hosted_acceptance_status() AS state
  `);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]?.state ?? "missing";
}

describe("Hosted DeepSeek acceptance private status migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    await database.exec(await readFile(baselineUrl, "utf8"));
    await database.exec(await readFile(authorityUrl, "utf8"));
    await database.exec(await readFile(retentionUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");

    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("returns one bounded safe state without mutating authority rows", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    expect(await readStatus(database)).toBe("absent");

    await insertReadyOperation(database, 1);
    expect(await readStatus(database)).toBe("ready");
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET state = 'running',
            lease_generation = 1,
            lease_token_hash = repeat('e', 64),
            lease_expires_at = clock_timestamp() + interval '120 seconds',
            updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [operationId(1)],
    );
    expect(await readStatus(database)).toBe("running");
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET state = 'cleanup-pending',
            lease_token_hash = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [operationId(1)],
    );
    expect(await readStatus(database)).toBe("cleanup-pending");
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET state = 'terminal', terminal_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [operationId(1)],
    );
    const before = await database.query(`
      SELECT * FROM huayi_private.hosted_acceptance_operations ORDER BY id
    `);
    expect(await readStatus(database)).toBe("terminal");
    const after = await database.query(`
      SELECT * FROM huayi_private.hosted_acceptance_operations ORDER BY id
    `);
    expect(after.rows).toEqual(before.rows);

    await insertReadyOperation(database, 2);
    expect(await readStatus(database)).toBe("ready");
  });

  it("fails closed for multiple current rows or an unknown current state", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    await database.exec(`DROP INDEX huayi_private.hosted_acceptance_one_non_terminal_operation;`);
    await insertReadyOperation(database, 1);
    await insertReadyOperation(database, 2);
    await expect(readStatus(database)).rejects.toThrow("hosted acceptance status unavailable");

    await database.exec(`
      DELETE FROM huayi_private.hosted_acceptance_operations
      WHERE id = '${operationId(2)}';
      ALTER TABLE huayi_private.hosted_acceptance_operations
        DROP CONSTRAINT hosted_acceptance_operations_state_check;
      ALTER TABLE huayi_private.hosted_acceptance_operations
        DROP CONSTRAINT hosted_acceptance_lease_state_check;
      ALTER TABLE huayi_private.hosted_acceptance_operations
        DISABLE TRIGGER hosted_acceptance_operation_state_guard;
      UPDATE huayi_private.hosted_acceptance_operations SET state = 'unknown';
    `);
    await expect(readStatus(database)).rejects.toThrow("hosted acceptance status unavailable");

    await database.exec(`
      ALTER TABLE huayi_private.hosted_acceptance_operations
        ALTER COLUMN state DROP NOT NULL;
      UPDATE huayi_private.hosted_acceptance_operations SET state = NULL;
    `);
    await expect(readStatus(database)).rejects.toThrow("hosted acceptance status unavailable");
  });

  it("grants only the executor role access to the fixed read-only function", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    const metadata = await database.query(`
      SELECT
        procedure.prosecdef AS security_definer,
        procedure.provolatile AS volatility,
        procedure.proconfig AS configuration,
        procedure.proretset AS returns_set
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'huayi_private'
        AND procedure.proname = 'read_hosted_acceptance_status'
    `);
    expect(metadata.rows).toEqual([
      {
        configuration: ["search_path=pg_catalog, huayi_private"],
        returns_set: false,
        security_definer: true,
        volatility: "s",
      },
    ]);

    const privileges = await database.query<{ canExecute: boolean; roleName: string }>(`
      SELECT
        role_name AS "roleName",
        has_function_privilege(
          role_name,
          'huayi_private.read_hosted_acceptance_status()',
          'EXECUTE'
        ) AS "canExecute"
      FROM unnest(ARRAY[
        'anon',
        'authenticated',
        'service_role',
        'huayi_business',
        'huayi_context_setter',
        'huayi_runtime',
        'huayi_hosted_acceptance_executor'
      ]) role_name
      ORDER BY role_name
    `);
    expect(privileges.rows).toEqual([
      { canExecute: false, roleName: "anon" },
      { canExecute: false, roleName: "authenticated" },
      { canExecute: false, roleName: "huayi_business" },
      { canExecute: false, roleName: "huayi_context_setter" },
      { canExecute: true, roleName: "huayi_hosted_acceptance_executor" },
      { canExecute: false, roleName: "huayi_runtime" },
      { canExecute: false, roleName: "service_role" },
    ]);

    await database.exec("SET ROLE huayi_hosted_acceptance_executor;");
    expect(await readStatus(database)).toBe("absent");
    await database.exec("RESET ROLE;");
    const relationSecurity = await database.query<{
      directAccess: boolean;
      forcedRls: boolean;
      relationName: string;
      rls: boolean;
    }>(`
      SELECT
        relation.relname AS "relationName",
        relation.relrowsecurity AS rls,
        relation.relforcerowsecurity AS "forcedRls",
        has_table_privilege(
          'huayi_hosted_acceptance_executor',
          'huayi_private.' || relation.relname,
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "directAccess"
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'huayi_private'
        AND relation.relname IN (
          'hosted_acceptance_cleanup_obligations',
          'hosted_acceptance_operations'
        )
      ORDER BY relation.relname
    `);
    expect(relationSecurity.rows).toEqual([
      {
        directAccess: false,
        forcedRls: true,
        relationName: "hosted_acceptance_cleanup_obligations",
        rls: true,
      },
      {
        directAccess: false,
        forcedRls: true,
        relationName: "hosted_acceptance_operations",
        rls: true,
      },
    ]);
  });
});
