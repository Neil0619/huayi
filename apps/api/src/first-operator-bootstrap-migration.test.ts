import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0012-first-operator-bootstrap.sql", import.meta.url);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260822030000_first_operator_bootstrap.sql",
  import.meta.url,
);

const invitationA = "41000000-0000-4000-8000-000000000001";
const invitationB = "41000000-0000-4000-8000-000000000002";
const userId = "42000000-0000-4000-8000-000000000001";

async function installAuthFixture(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE auth.identities (id text PRIMARY KEY, user_id uuid NOT NULL);
  `);
}

describe("first Operator bootstrap database protocol", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(baselineUrl, "utf8"));
    await installAuthFixture(database);
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(
      await readFile(forwardUrl, "utf8"),
    );
  });

  it("replays the forward migration on the current baseline and upgrades the prior schema shape", async () => {
    const forward = await readFile(forwardUrl, "utf8");
    await expect(database.exec(forward)).resolves.toBeDefined();
    await expect(
      database.query(`
        SELECT count(*)::integer AS constraint_count
        FROM pg_constraint
        WHERE conrelid='invitations'::regclass
          AND conname='invitations_created_by_kind_check'
      `),
    ).resolves.toMatchObject({ rows: [{ constraint_count: 1 }] });

    const legacy = new PGlite();
    await legacy.waitReady;
    try {
      await legacy.exec(await readFile(baselineUrl, "utf8"));
      await legacy.exec(`
        DROP TRIGGER user_profile_clear_first_operator_identity ON user_profiles;
        DROP FUNCTION huayi_private.clear_deleted_first_operator_identity();
        DROP FUNCTION huayi_private.complete_first_operator_bootstrap(timestamptz);
        DROP FUNCTION huayi_private.replace_first_operator_invitation(
          uuid,text,timestamptz,timestamptz
        );
        DROP FUNCTION huayi_private.issue_first_operator_invitation(
          uuid,text,timestamptz,timestamptz
        );
        DROP TABLE huayi_private.first_operator_bootstrap;
        ALTER TABLE invitations DROP CONSTRAINT invitations_created_by_kind_check;
        ALTER TABLE invitations DROP COLUMN created_by_kind;
        ALTER TABLE invitations ALTER COLUMN created_by SET NOT NULL;
      `);
      await legacy.exec(forward);
      await expect(
        legacy.query(`
          SELECT attnotnull,has_column_privilege(
            'huayi_runtime','public.invitations','created_by_kind','SELECT'
          ) AS runtime_can_read_issuer
          FROM pg_attribute
          WHERE attrelid='invitations'::regclass AND attname='created_by'
        `),
      ).resolves.toMatchObject({
        rows: [{ attnotnull: false, runtime_can_read_issuer: false }],
      });
    } finally {
      await legacy.close();
    }
  });

  it("issues exactly one deployment-bootstrap invitation from a pristine identity state", async () => {
    await database.query(`
      SELECT huayi_private.issue_first_operator_invitation(
        '${invitationA}',repeat('a',43),'2026-08-25T00:00:00Z','2026-08-22T00:00:00Z'
      )
    `);

    await expect(
      database.query(`
        SELECT created_by::text,created_by_kind,consumed_at,revoked_at
        FROM invitations WHERE id='${invitationA}'
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          consumed_at: null,
          created_by: null,
          created_by_kind: "deployment-bootstrap",
          revoked_at: null,
        },
      ],
    });
    await expect(
      database.query(`
        SELECT state,current_invitation_id::text,revision,operator_user_id::text
        FROM huayi_private.first_operator_bootstrap
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          current_invitation_id: invitationA,
          operator_user_id: null,
          revision: 1,
          state: "invited",
        },
      ],
    });
    await expect(
      database.query(`
        SELECT huayi_private.issue_first_operator_invitation(
          '${invitationB}',repeat('b',43),'2026-08-25T00:00:00Z','2026-08-22T00:00:00Z'
        )
      `),
    ).rejects.toThrow();
  });

  it("replaces only an entirely unclaimed invitation and advances one revision", async () => {
    await database.query(`
      SELECT huayi_private.issue_first_operator_invitation(
        '${invitationA}',repeat('a',43),'2026-08-25T00:00:00Z','2026-08-22T00:00:00Z'
      )
    `);
    await database.query(`
      SELECT huayi_private.replace_first_operator_invitation(
        '${invitationB}',repeat('b',43),'2026-08-25T01:00:00Z','2026-08-22T01:00:00Z'
      )
    `);
    await expect(
      database.query(`
        SELECT id::text,revoked_at IS NOT NULL AS revoked
        FROM invitations ORDER BY id
      `),
    ).resolves.toMatchObject({
      rows: [
        { id: invitationA, revoked: true },
        { id: invitationB, revoked: false },
      ],
    });
    await expect(
      database.query(`
        SELECT current_invitation_id::text,revision
        FROM huayi_private.first_operator_bootstrap
      `),
    ).resolves.toMatchObject({
      rows: [{ current_invitation_id: invitationB, revision: 2 }],
    });

    await database.query(`
      SELECT claim_invitation(repeat('b',43),'claim-ticket','2026-08-22T02:00:00Z')
    `);
    await expect(
      database.query(`
        SELECT huayi_private.replace_first_operator_invitation(
          '41000000-0000-4000-8000-000000000003',repeat('c',43),
          '2026-08-25T02:00:00Z','2026-08-22T02:00:00Z'
        )
      `),
    ).rejects.toThrow();
  });

  it("promotes only the account finalized by the current bootstrap invitation", async () => {
    await database.exec(`
      SELECT huayi_private.issue_first_operator_invitation(
        '${invitationA}',repeat('a',43),now()+interval '72 hours',now()
      );
      INSERT INTO auth.users(id) VALUES ('${userId}');
      INSERT INTO auth.identities(id,user_id) VALUES ('identity-a','${userId}');
      SELECT claim_invitation(repeat('a',43),'claim-ticket',now()+interval '15 minutes');
      SELECT bind_auth_identity('claim-ticket','${userId}');
      SELECT finalize_invitation(
        'claim-ticket','${userId}','operator@example.test','Asia/Shanghai',5,'password'
      );
    `);

    await expect(
      database.query<{ completed_user_id: string }>(`
        SELECT huayi_private.complete_first_operator_bootstrap(now())::text
          AS completed_user_id
      `),
    ).resolves.toMatchObject({ rows: [{ completed_user_id: userId }] });
    await expect(
      database.query(`
        SELECT roles.user_id::text,roles.role,bootstrap.state,
          bootstrap.operator_user_id::text,bootstrap.completed_at IS NOT NULL AS completed
        FROM admin_roles roles
        CROSS JOIN huayi_private.first_operator_bootstrap bootstrap
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          completed: true,
          operator_user_id: userId,
          role: "operator",
          state: "completed",
          user_id: userId,
        },
      ],
    });
    await expect(
      database.query(`SELECT huayi_private.complete_first_operator_bootstrap(now())`),
    ).rejects.toThrow();

    await database.exec(`DELETE FROM user_profiles WHERE user_id='${userId}'`);
    await expect(
      database.query(`
        SELECT state,operator_user_id::text,
          operator_deleted_at IS NOT NULL AS identity_cleared
        FROM huayi_private.first_operator_bootstrap
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          identity_cleared: true,
          operator_user_id: null,
          state: "completed",
        },
      ],
    });
  });

  it("keeps an incomplete registered candidate unprivileged", async () => {
    await database.exec(`
      SELECT huayi_private.issue_first_operator_invitation(
        '${invitationA}',repeat('a',43),now()+interval '72 hours',now()
      );
      INSERT INTO auth.users(id) VALUES ('${userId}');
      INSERT INTO auth.identities(id,user_id) VALUES ('identity-a','${userId}');
      SELECT claim_invitation(repeat('a',43),'claim-ticket',now()+interval '15 minutes');
      SELECT bind_auth_identity('claim-ticket','${userId}');
      SELECT finalize_invitation(
        'claim-ticket','${userId}','operator@example.test','Asia/Shanghai',5,'google'
      );
      DELETE FROM quota_grants WHERE user_id='${userId}';
    `);
    await expect(
      database.query(`SELECT huayi_private.complete_first_operator_bootstrap(now())`),
    ).rejects.toThrow();
    await expect(
      database.query(`
        SELECT (SELECT count(*)::integer FROM admin_roles) AS role_count,
          (SELECT state FROM huayi_private.first_operator_bootstrap) AS state
      `),
    ).resolves.toMatchObject({ rows: [{ role_count: 0, state: "invited" }] });
  });

  it("preserves ordinary Operator invitation provenance", async () => {
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','operator@example.test','active','UTC',5);
      INSERT INTO admin_roles(user_id,role) VALUES('${userId}','operator');
      SELECT admin_create_invitation(
        '${invitationA}','ordinary-token',now()+interval '72 hours','${userId}',
        '43000000-0000-4000-8000-000000000001'
      );
    `);
    await expect(
      database.query(`
        SELECT created_by::text,created_by_kind FROM invitations WHERE id='${invitationA}'
      `),
    ).resolves.toMatchObject({
      rows: [{ created_by: userId, created_by_kind: "operator" }],
    });
  });

  it("fails closed on partial identity state and grants no bootstrap access to runtime roles", async () => {
    await database.exec(`INSERT INTO auth.users(id) VALUES ('${userId}')`);
    await expect(
      database.query(`
        SELECT huayi_private.issue_first_operator_invitation(
          '${invitationA}',repeat('a',43),now()+interval '72 hours',now()
        )
      `),
    ).rejects.toThrow();

    const privileges = await database.query<{
      business_execute: boolean;
      context_execute: boolean;
      runtime_execute: boolean;
      runtime_insert_role: boolean;
      runtime_select: boolean;
    }>(`
      SELECT
        has_function_privilege(
          'huayi_business',
          'huayi_private.issue_first_operator_invitation(uuid,text,timestamptz,timestamptz)',
          'EXECUTE'
        ) AS business_execute,
        has_function_privilege(
          'huayi_context_setter',
          'huayi_private.complete_first_operator_bootstrap(timestamptz)',
          'EXECUTE'
        ) AS context_execute,
        has_function_privilege(
          'huayi_runtime',
          'huayi_private.replace_first_operator_invitation(uuid,text,timestamptz,timestamptz)',
          'EXECUTE'
        ) AS runtime_execute,
        has_table_privilege(
          'huayi_runtime','huayi_private.first_operator_bootstrap','SELECT'
        ) AS runtime_select,
        has_table_privilege('huayi_runtime','public.admin_roles','INSERT')
          AS runtime_insert_role
    `);
    expect(privileges.rows).toEqual([
      {
        business_execute: false,
        context_execute: false,
        runtime_execute: false,
        runtime_insert_role: false,
        runtime_select: false,
      },
    ]);
  });
});
