import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const otpResendUrl = new URL("../migrations/0014-password-signup-otp-resend.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0015-public-function-acl-hardening.sql", import.meta.url);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260825010000_public_function_acl_hardening.sql",
  import.meta.url,
);

const apiRoles = ["anon", "authenticated", "service_role"] as const;

describe("public function ACL hardening migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    `);
    await database.exec(await readFile(baselineUrl, "utf8"));
    await database.exec(await readFile(otpResendUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");

    expect(forward).toBe(`BEGIN;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

COMMIT;
`);
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("reproduces and removes Supabase API-role access from every existing public function", async () => {
    const before = await database.query<{
      authenticatedExecutable: number;
      securityDefinerTotal: number;
      serviceRoleExecutable: number;
      anonExecutable: number;
    }>(`
      SELECT
        count(*) FILTER (WHERE procedure.prosecdef)::integer AS "securityDefinerTotal",
        count(*) FILTER (
          WHERE procedure.prosecdef
            AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
        )::integer AS "anonExecutable",
        count(*) FILTER (
          WHERE procedure.prosecdef
            AND has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        )::integer AS "authenticatedExecutable",
        count(*) FILTER (
          WHERE procedure.prosecdef
            AND has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        )::integer AS "serviceRoleExecutable"
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
    `);
    expect(before.rows[0]?.securityDefinerTotal).toBeGreaterThan(0);
    expect(before.rows[0]?.anonExecutable).toBe(before.rows[0]?.securityDefinerTotal);
    expect(before.rows[0]?.authenticatedExecutable).toBe(before.rows[0]?.securityDefinerTotal);
    expect(before.rows[0]?.serviceRoleExecutable).toBe(before.rows[0]?.securityDefinerTotal);

    await database.exec(await readFile(forwardUrl, "utf8"));

    const after = await database.query<{
      apiRoleDirectExecuteGrants: number;
      apiRoleEffectiveExecuteGrants: number;
      publicFunctions: number;
    }>(`
      SELECT
        count(*)::integer AS "publicFunctions",
        count(*) FILTER (
          WHERE has_function_privilege('anon', procedure.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
             OR has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        )::integer AS "apiRoleEffectiveExecuteGrants",
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
            ) privilege
            JOIN pg_roles grantee ON grantee.oid = privilege.grantee
            WHERE privilege.privilege_type = 'EXECUTE'
              AND grantee.rolname IN ('anon', 'authenticated', 'service_role')
          )
        )::integer AS "apiRoleDirectExecuteGrants"
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
    `);
    expect(after.rows).toEqual([
      {
        apiRoleDirectExecuteGrants: 0,
        apiRoleEffectiveExecuteGrants: 0,
        publicFunctions: expect.any(Number),
      },
    ]);
    expect(after.rows[0]?.publicFunctions).toBeGreaterThan(0);
  });

  it("preserves the exact Huayi grants on the 0014 functions", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));

    const result = await database.query(`
      SELECT
        has_function_privilege(
          'huayi_context_setter',
          'bind_auth_identity(text,uuid)',
          'EXECUTE'
        ) AS bind_setter,
        has_function_privilege(
          'huayi_context_setter',
          'renew_interrupted_password_confirmation(text,text,timestamptz)',
          'EXECUTE'
        ) AS renew_setter,
        has_function_privilege(
          'huayi_business',
          'bind_auth_identity(text,uuid)',
          'EXECUTE'
        ) AS bind_business,
        has_function_privilege(
          'huayi_runtime',
          'bind_auth_identity(text,uuid)',
          'EXECUTE'
        ) AS bind_runtime,
        has_function_privilege(
          'huayi_business',
          'renew_interrupted_password_confirmation(text,text,timestamptz)',
          'EXECUTE'
        ) AS renew_business,
        has_function_privilege(
          'huayi_runtime',
          'renew_interrupted_password_confirmation(text,text,timestamptz)',
          'EXECUTE'
        ) AS renew_runtime
    `);

    expect(result.rows).toEqual([
      {
        bind_business: false,
        bind_runtime: false,
        bind_setter: true,
        renew_business: false,
        renew_runtime: false,
        renew_setter: true,
      },
    ]);
  });

  it("removes global and public-schema defaults so future functions are owner-only", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    await database.exec(`
      CREATE FUNCTION public.acl_hardening_probe()
      RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    `);

    const privileges = await database.query(`
      SELECT
        has_function_privilege('postgres', 'acl_hardening_probe()', 'EXECUTE') AS owner,
        has_function_privilege('anon', 'acl_hardening_probe()', 'EXECUTE') AS anon,
        has_function_privilege(
          'authenticated',
          'acl_hardening_probe()',
          'EXECUTE'
        ) AS authenticated,
        has_function_privilege(
          'service_role',
          'acl_hardening_probe()',
          'EXECUTE'
        ) AS service_role
    `);
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, owner: true, service_role: false },
    ]);

    const defaults = await database.query(
      `
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_default_acl defaults
          JOIN pg_roles owner ON owner.oid = defaults.defaclrole
          WHERE owner.rolname = 'postgres'
            AND defaults.defaclobjtype = 'f'
            AND defaults.defaclnamespace = 0
        ) AS "globalEntryPresent",
        NOT EXISTS (
          SELECT 1
          FROM pg_default_acl defaults
          CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
          LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
          WHERE defaults.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
            AND defaults.defaclobjtype = 'f'
            AND defaults.defaclnamespace = 0
            AND privilege.privilege_type = 'EXECUTE'
            AND (privilege.grantee = 0 OR grantee.rolname = ANY($1::text[]))
        ) AS "globalExternalExecuteAbsent",
        NOT EXISTS (
          SELECT 1
          FROM pg_default_acl defaults
          JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
          CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
          JOIN pg_roles grantee ON grantee.oid = privilege.grantee
          WHERE defaults.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
            AND defaults.defaclobjtype = 'f'
            AND namespace.nspname = 'public'
            AND privilege.privilege_type = 'EXECUTE'
            AND grantee.rolname = ANY($1::text[])
        ) AS "publicApiRoleExecuteAbsent"
    `,
      [apiRoles],
    );
    expect(defaults.rows).toEqual([
      {
        globalEntryPresent: true,
        globalExternalExecuteAbsent: true,
        publicApiRoleExecuteAbsent: true,
      },
    ]);
  });

  it("proves a schema-scoped PUBLIC revoke alone cannot override the global default", async () => {
    await database.exec(`
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      CREATE FUNCTION public.schema_only_revoke_probe()
      RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    `);

    const result = await database.query(`
      SELECT has_function_privilege(
        'anon',
        'schema_only_revoke_probe()',
        'EXECUTE'
      ) AS anon
    `);
    expect(result.rows).toEqual([{ anon: true }]);
  });
});
