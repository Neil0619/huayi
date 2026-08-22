import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const quotaUrl = new URL("../migrations/0002-account-default-quota.sql", import.meta.url);
const callbackUrl = new URL(
  "../migrations/0003-password-auth-callback-method.sql",
  import.meta.url,
);
const supabaseCallbackUrl = new URL(
  "../../../supabase/migrations/20260821020000_password_auth_callback_method.sql",
  import.meta.url,
);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

async function databaseBeforeCallbackMigration() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(await readFile(baselineUrl, "utf8"));
  await database.exec(await readFile(quotaUrl, "utf8"));
  return database;
}

describe("password authentication callback method migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const [apiMigration, supabaseMigration] = await Promise.all([
      readFile(callbackUrl, "utf8"),
      readFile(supabaseCallbackUrl, "utf8"),
    ]);
    expect(supabaseMigration).toEqual(apiMigration);
  });

  it("registers the callback method explicitly and rejects password ordinary login flows", async () => {
    database = await databaseBeforeCallbackMigration();
    await database.exec(await readFile(callbackUrl, "utf8"));
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by) VALUES
        ('20000000-0000-4000-8000-000000000001','password-token',now()+interval '72 hours','${userB}'),
        ('20000000-0000-4000-8000-000000000002','google-token',now()+interval '72 hours','${userB}');
      SELECT claim_invitation('password-token','password-ticket',now()+interval '15 minutes');
      SELECT bind_auth_identity('password-ticket','${userA}');
      SELECT create_auth_flow('password-ticket','password-flow',now()+interval '15 minutes');
    `);

    const password = await database.query<{ id: string | null }>(`
      SELECT complete_auth_flow(
        'password-flow','${userA}','a@example.test','UTC',5,'password'
      )::text AS id
    `);
    const methods = await database.query<{ method: string }>(`
      SELECT method FROM account_sign_in_methods WHERE owner_user_id='${userA}' ORDER BY method
    `);
    await database.exec(`
      SELECT create_login_auth_flow('password-login-flow',now()+interval '15 minutes');
    `);
    const rejectedLogin = await database.query<{ id: string | null }>(`
      SELECT complete_auth_flow(
        'password-login-flow','${userA}','a@example.test','UTC',5,'password'
      )::text AS id
    `);

    expect(password.rows).toEqual([{ id: userA }]);
    expect(methods.rows).toEqual([{ method: "password" }]);
    expect(rejectedLogin.rows).toEqual([{ id: null }]);
  });

  it("repairs an invited email identity that the old callback mislabeled as Google", async () => {
    database = await databaseBeforeCallbackMigration();
    await database.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.identities(user_id uuid NOT NULL,provider text NOT NULL);
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES
        ('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','active','UTC',5);
      INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES
        ('${userA}','google'),
        ('${userB}','google');
      INSERT INTO invitations(id,token_hash,expires_at,created_by,consumed_at)
      VALUES
        (
          '20000000-0000-4000-8000-000000000003','old-token',now()+interval '72 hours',
          '${userB}',now()
        ),
        (
          '20000000-0000-4000-8000-000000000004','google-token',now()+interval '72 hours',
          '${userA}',now()
        );
      INSERT INTO invitation_claims(
        ticket_hash,invitation_id,expires_at,bound_user_id,finalized_user_id
      ) VALUES
        (
          'old-ticket','20000000-0000-4000-8000-000000000003',now()+interval '15 minutes',
          '${userA}','${userA}'
        ),
        (
          'google-ticket','20000000-0000-4000-8000-000000000004',
          now()+interval '15 minutes','${userB}','${userB}'
        );
      INSERT INTO auth.identities(user_id,provider) VALUES
        ('${userA}','email'),
        ('${userB}','google');
    `);

    await database.exec(await readFile(callbackUrl, "utf8"));
    const methods = await database.query<{ method: string; owner_user_id: string }>(`
      SELECT owner_user_id::text,method FROM account_sign_in_methods ORDER BY owner_user_id
    `);

    expect(methods.rows).toEqual([
      { method: "password", owner_user_id: userA },
      { method: "google", owner_user_id: userB },
    ]);
  });

  it("refreshes the confirmed profile email through a context-setter-only function", async () => {
    database = await databaseBeforeCallbackMigration();
    await database.exec(await readFile(callbackUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userA}','${userA}','before@example.test','active','UTC',5);
    `);

    const refreshed = await database.transaction(async (transaction) => {
      await transaction.exec("SET LOCAL ROLE huayi_context_setter");
      return transaction.query<{ refreshed: boolean }>(`
        SELECT refresh_profile_email('${userA}','after@example.test') AS refreshed
      `);
    });
    const profile = await database.query<{ email: string }>(`
      SELECT email FROM user_profiles WHERE user_id='${userA}'
    `);
    const privileges = await database.query<{
      business: boolean;
      context_setter: boolean;
      public_role: boolean;
    }>(`
      SELECT
        has_function_privilege(
          'huayi_business','refresh_profile_email(uuid,text)','EXECUTE'
        ) AS business,
        has_function_privilege(
          'huayi_context_setter','refresh_profile_email(uuid,text)','EXECUTE'
        ) AS context_setter,
        has_function_privilege(
          'public','refresh_profile_email(uuid,text)','EXECUTE'
        ) AS public_role
    `);

    expect(refreshed.rows).toEqual([{ refreshed: true }]);
    expect(profile.rows).toEqual([{ email: "after@example.test" }]);
    expect(privileges.rows).toEqual([
      { business: false, context_setter: true, public_role: false },
    ]);
  });
});
