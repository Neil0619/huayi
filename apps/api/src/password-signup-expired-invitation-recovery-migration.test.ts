import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const interruptionRecoveryUrl = new URL(
  "../migrations/0013-password-signup-interruption-recovery.sql",
  import.meta.url,
);
const otpResendUrl = new URL("../migrations/0014-password-signup-otp-resend.sql", import.meta.url);
const aclHardeningUrl = new URL(
  "../migrations/0015-public-function-acl-hardening.sql",
  import.meta.url,
);
const forwardUrl = new URL(
  "../migrations/0022-password-signup-expired-invitation-recovery.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260828010000_password_signup_expired_invitation_recovery.sql",
  import.meta.url,
);

const invitationId = "71000000-0000-4000-8000-000000000001";
const userId = "72000000-0000-4000-8000-000000000001";

describe("password signup expired invitation recovery migration", () => {
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
    await database.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text,
        email_confirmed_at timestamptz
      );
      CREATE TABLE auth.identities (
        id text PRIMARY KEY,
        user_id uuid NOT NULL,
        provider text NOT NULL
      );
    `);
    await database.exec(await readFile(interruptionRecoveryUrl, "utf8"));
    await database.exec(await readFile(otpResendUrl, "utf8"));
    await database.exec(await readFile(aclHardeningUrl, "utf8"));
  });

  afterEach(async () => database.close());

  async function seedExpiredOrdinaryRegistration() {
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by,created_by_kind)
      VALUES(
        '${invitationId}',repeat('i',43),now()+interval '1 day',
        '73000000-0000-4000-8000-000000000001','operator'
      );
      SELECT claim_invitation(repeat('i',43),repeat('c',43),now()+interval '15 minutes');
      SELECT create_auth_flow(repeat('c',43),repeat('f',43),now()+interval '15 minutes');
      INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES('${userId}','learner@example.com',NULL);
      INSERT INTO auth.identities(id,user_id,provider)
      VALUES('email-identity','${userId}','email');
      SELECT bind_auth_identity(repeat('c',43),'${userId}');
      UPDATE invitations SET created_at=now()-interval '2 hours';
      UPDATE invitations SET expires_at=now()-interval '1 second';
      UPDATE invitation_claims SET expires_at=now()-interval '1 second';
      UPDATE auth_flows SET created_at=now()-interval '1 hour';
      UPDATE auth_flows SET expires_at=now()-interval '1 second';
    `);
  }

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");
    expect(forward.startsWith("BEGIN;\n")).toBe(true);
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("reactivates the same ordinary invitation, claim, flow, user, and email identity", async () => {
    await seedExpiredOrdinaryRegistration();
    await database.exec(await readFile(forwardUrl, "utf8"));

    await expect(
      database.query(`
        SELECT * FROM renew_interrupted_password_confirmation(
          repeat('i',43),repeat('n',43),now()+interval '15 minutes'
        )
      `),
    ).resolves.toMatchObject({ rows: [{ account_email: "learner@example.com" }] });
    await expect(
      database.query(`
        SELECT
          (SELECT count(*) FROM invitations)::integer AS invitations,
          (SELECT count(*) FROM invitation_claims)::integer AS claims,
          (SELECT count(*) FROM auth_flows)::integer AS flows,
          (SELECT count(*) FROM auth.users)::integer AS users,
          (SELECT count(*) FROM auth.identities)::integer AS identities,
          (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('f',43))::integer AS old_flows,
          (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('n',43))::integer AS new_flows,
          (SELECT expires_at > now() FROM invitations) AS invitation_active,
          (SELECT invitations.expires_at = claims.expires_at + interval '15 minutes'
             FROM invitations CROSS JOIN invitation_claims AS claims) AS invitation_retry_window,
          (SELECT claims.expires_at = flows.expires_at
             FROM invitation_claims AS claims CROSS JOIN auth_flows AS flows) AS flow_expiry_exact,
          (SELECT flows.expires_at <= now() + interval '15 minutes'
             FROM auth_flows AS flows) AS flow_window_bounded
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          claims: 1,
          flow_expiry_exact: true,
          flow_window_bounded: true,
          flows: 1,
          identities: 1,
          invitation_active: true,
          invitation_retry_window: true,
          invitations: 1,
          new_flows: 1,
          old_flows: 0,
          users: 1,
        },
      ],
    });

    await expect(
      database.query(`
        SELECT claim_invitation(
          repeat('i',43),repeat('r',43),now()+interval '15 minutes'
        )::text AS id
      `),
    ).resolves.toMatchObject({ rows: [{ id: null }] });
    await expect(
      database.query("SELECT count(*)::integer AS count FROM invitation_claims"),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("preserves the active-invitation resend contract without extending its lifetime", async () => {
    await seedExpiredOrdinaryRegistration();
    await database.exec("UPDATE invitations SET expires_at=now()+interval '1 day'");
    await database.exec(await readFile(forwardUrl, "utf8"));

    await expect(
      database.query(`
        WITH prior AS (SELECT expires_at FROM invitations),
        renewed AS (
          SELECT * FROM renew_interrupted_password_confirmation(
            repeat('i',43),repeat('n',43),now()+interval '15 minutes'
          )
        )
        SELECT renewed.account_email,
          (SELECT invitations.expires_at = prior.expires_at
             FROM invitations CROSS JOIN prior) AS invitation_expiry_unchanged
        FROM renewed
      `),
    ).resolves.toMatchObject({
      rows: [{ account_email: "learner@example.com", invitation_expiry_unchanged: true }],
    });
  });

  it("keeps the recovered invitation active for a second Provider delivery attempt", async () => {
    await seedExpiredOrdinaryRegistration();
    await database.exec(await readFile(forwardUrl, "utf8"));

    await expect(
      database.query(`
        SELECT * FROM renew_interrupted_password_confirmation(
          repeat('i',43),repeat('n',43),now()+interval '14 minutes'
        )
      `),
    ).resolves.toMatchObject({ rows: [{ account_email: "learner@example.com" }] });
    await expect(
      database.query(`
        SELECT * FROM renew_interrupted_password_confirmation(
          repeat('i',43),repeat('r',43),now()+interval '15 minutes'
        )
      `),
    ).resolves.toMatchObject({ rows: [{ account_email: "learner@example.com" }] });
  });

  it("fails closed with zero writes outside the exact expired ordinary-registration shape", async () => {
    await seedExpiredOrdinaryRegistration();
    await database.exec(await readFile(forwardUrl, "utf8"));

    const cases = [
      "UPDATE auth.users SET email_confirmed_at=now()",
      `INSERT INTO auth.identities(id,user_id,provider)
       VALUES('extra-identity','${userId}','google')`,
      `INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
       VALUES('${userId}','${userId}','learner@example.com','active','UTC',5)`,
      "UPDATE invitation_claims SET bound_email='other@example.com'",
      `UPDATE invitation_claims SET finalized_user_id='${userId}'`,
      "UPDATE invitation_claims SET expires_at=now()+interval '1 minute'",
      "UPDATE auth_flows SET expires_at=now()+interval '1 minute'",
      "UPDATE auth_flows SET consumed_at=now()",
      "UPDATE invitations SET revoked_at=now()",
      "UPDATE invitations SET consumed_at=now()",
      "UPDATE invitations SET created_by=NULL,created_by_kind='deployment-bootstrap'",
      `INSERT INTO invitation_claims(ticket_hash,invitation_id,expires_at)
       VALUES(repeat('x',43),'${invitationId}',now()-interval '1 second')`,
      `INSERT INTO auth_flows(flow_hash,ticket_hash,expires_at,created_at)
       VALUES(repeat('x',43),repeat('c',43),now()-interval '1 second',now()-interval '1 hour')`,
    ];

    for (const setup of cases) {
      await database.exec(`BEGIN; ${setup};`);
      await expect(
        database.query(`
          SELECT * FROM renew_interrupted_password_confirmation(
            repeat('i',43),repeat('n',43),now()+interval '15 minutes'
          )
        `),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        database.query(`
          SELECT
            (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('f',43))::integer AS old_flows,
            (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('n',43))::integer AS new_flows,
            (SELECT expires_at <= now() FROM invitations) AS invitation_still_expired
        `),
      ).resolves.toMatchObject({
        rows: [{ invitation_still_expired: true, new_flows: 0, old_flows: 1 }],
      });
      await database.exec("ROLLBACK;");
    }

    await expect(
      database.query(`
        SELECT * FROM renew_interrupted_password_confirmation(
          repeat('z',43),repeat('n',43),now()+interval '15 minutes'
        )
      `),
    ).resolves.toMatchObject({ rows: [] });
  });

  it("keeps the replaced function private to the context setter", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    await expect(
      database.query(`
        SELECT
          has_function_privilege(
            'huayi_context_setter',
            'renew_interrupted_password_confirmation(text,text,timestamptz)',
            'EXECUTE'
          ) AS context_setter,
          has_function_privilege(
            'huayi_business',
            'renew_interrupted_password_confirmation(text,text,timestamptz)',
            'EXECUTE'
          ) AS business,
          has_function_privilege(
            'huayi_runtime',
            'renew_interrupted_password_confirmation(text,text,timestamptz)',
            'EXECUTE'
          ) AS runtime,
          has_function_privilege(
            'anon',
            'renew_interrupted_password_confirmation(text,text,timestamptz)',
            'EXECUTE'
          ) AS anon,
          has_function_privilege(
            'authenticated',
            'renew_interrupted_password_confirmation(text,text,timestamptz)',
            'EXECUTE'
          ) AS authenticated,
          has_function_privilege(
            'service_role',
            'renew_interrupted_password_confirmation(text,text,timestamptz)',
            'EXECUTE'
          ) AS service_role
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          anon: false,
          authenticated: false,
          business: false,
          context_setter: true,
          runtime: false,
          service_role: false,
        },
      ],
    });
  });
});
