import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0014-password-signup-otp-resend.sql", import.meta.url);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260824010000_password_signup_otp_resend.sql",
  import.meta.url,
);

const invitationId = "61000000-0000-4000-8000-000000000001";
const userId = "62000000-0000-4000-8000-000000000001";

describe("password signup OTP resend migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
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
  });

  afterEach(async () => database.close());

  async function seedPendingRegistration() {
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by)
      VALUES('${invitationId}',repeat('i',43),now()+interval '1 day','63000000-0000-4000-8000-000000000001');
      SELECT claim_invitation(repeat('i',43),repeat('c',43),now()+interval '15 minutes');
      SELECT create_auth_flow(repeat('c',43),repeat('f',43),now()+interval '15 minutes');
      INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES('${userId}','learner@example.com',NULL);
      INSERT INTO auth.identities(id,user_id,provider)
      VALUES('email-identity','${userId}','email');
      SELECT bind_auth_identity(repeat('c',43),'${userId}');
    `);
  }

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");
    expect(forward.startsWith("BEGIN;\n")).toBe(true);
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("rotates one unconfirmed bound flow without creating another invitation or identity", async () => {
    await seedPendingRegistration();
    await database.exec(`
      UPDATE invitation_claims SET expires_at=now()-interval '1 second';
      UPDATE auth_flows SET created_at=now()-interval '1 hour';
      UPDATE auth_flows SET expires_at=now()-interval '1 second';
    `);
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
          (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('f',43))::integer AS old_flows,
          (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('n',43))::integer AS new_flows,
          (SELECT count(*) FROM auth.users)::integer AS users,
          (SELECT count(*) FROM auth.identities)::integer AS identities,
          (SELECT bound_email FROM invitation_claims) AS bound_email
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          claims: 1,
          bound_email: "learner@example.com",
          flows: 1,
          identities: 1,
          invitations: 1,
          new_flows: 1,
          old_flows: 0,
          users: 1,
        },
      ],
    });
  });

  it("fails closed without rotating for wrong or ineligible bound identity states", async () => {
    await seedPendingRegistration();
    await database.exec(await readFile(forwardUrl, "utf8"));

    const cases = [
      "UPDATE auth.users SET email_confirmed_at=now()",
      `INSERT INTO auth.identities(id,user_id,provider)
       VALUES('extra-identity','${userId}','google')`,
      `INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
       VALUES('${userId}','${userId}','learner@example.com','active','UTC',5)`,
      "UPDATE invitation_claims SET bound_user_id=NULL",
      "UPDATE invitation_claims SET bound_email='other@example.com'",
      `UPDATE invitation_claims SET finalized_user_id='${userId}'`,
      "UPDATE auth_flows SET consumed_at=now()",
      "UPDATE invitations SET revoked_at=now()",
      `UPDATE invitations SET created_at=now()-interval '1 hour';
       UPDATE invitations SET expires_at=now()-interval '1 second'`,
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
            (SELECT count(*) FROM auth_flows WHERE flow_hash=repeat('n',43))::integer AS new_flows
        `),
      ).resolves.toMatchObject({ rows: [{ new_flows: 0, old_flows: 1 }] });
      await database.exec("ROLLBACK;");
    }

    await expect(
      database.query(`
        SELECT * FROM renew_interrupted_password_confirmation(
          repeat('x',43),repeat('n',43),now()+interval '15 minutes'
        )
      `),
    ).resolves.toMatchObject({ rows: [] });
  });

  it("grants resend renewal only to the context setter role", async () => {
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
          ) AS runtime
      `),
    ).resolves.toMatchObject({
      rows: [{ business: false, context_setter: true, runtime: false }],
    });
  });
});
