import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL(
  "../migrations/0016-hosted-deepseek-acceptance-authority.sql",
  import.meta.url,
);

describe("Hosted DeepSeek acceptance authority ACL", () => {
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
    await database.exec(await readFile(forwardUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps tables and trigger functions inaccessible to application roles", async () => {
    const role = await database.query(`
      SELECT rolcanlogin, rolinherit, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'huayi_hosted_acceptance_executor'
    `);
    expect(role.rows).toEqual([{ rolbypassrls: false, rolcanlogin: false, rolinherit: false }]);

    const relations = await database.query<{
      operationAccess: boolean;
      cleanupAccess: boolean;
      roleName: string;
    }>(`
      SELECT
        role_name AS "roleName",
        has_table_privilege(
          role_name,
          'huayi_private.hosted_acceptance_operations',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "operationAccess",
        has_table_privilege(
          role_name,
          'huayi_private.hosted_acceptance_cleanup_obligations',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "cleanupAccess"
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
    expect(relations.rows).toHaveLength(7);
    expect(relations.rows.every((row) => !row.operationAccess && !row.cleanupAccess)).toBe(true);

    const functions = await database.query(`
      SELECT
        has_function_privilege(
          'huayi_hosted_acceptance_executor',
          'huayi_private.enforce_hosted_acceptance_operation_state()',
          'EXECUTE'
        ) AS operation_trigger,
        has_function_privilege(
          'huayi_hosted_acceptance_executor',
          'huayi_private.enforce_hosted_acceptance_cleanup_state()',
          'EXECUTE'
        ) AS cleanup_trigger
    `);
    expect(functions.rows).toEqual([{ cleanup_trigger: false, operation_trigger: false }]);

    const rowSecurity = await database.query(`
      SELECT relname, relforcerowsecurity, relrowsecurity
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'huayi_private'
        AND relation.relkind = 'r'
        AND relname LIKE 'hosted_acceptance_%'
      ORDER BY relname
    `);
    expect(rowSecurity.rows).toEqual([
      {
        relforcerowsecurity: true,
        relname: "hosted_acceptance_cleanup_obligations",
        relrowsecurity: true,
      },
      {
        relforcerowsecurity: true,
        relname: "hosted_acceptance_operations",
        relrowsecurity: true,
      },
    ]);
  });
});
