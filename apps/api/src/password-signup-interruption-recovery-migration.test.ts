import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL(
  "../migrations/0013-password-signup-interruption-recovery.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260823010000_password_signup_interruption_recovery.sql",
  import.meta.url,
);

const invitationId = "51000000-0000-4000-8000-000000000001";
const userId = "52000000-0000-4000-8000-000000000001";

describe("password signup interruption recovery migration", () => {
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

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");
    expect(forward.startsWith("BEGIN;\n")).toBe(true);
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("preserves a bound expired claim and atomically resumes only its provider identity", async () => {
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by)
      VALUES('${invitationId}',repeat('i',43),now()+interval '1 day','53000000-0000-4000-8000-000000000001');
      SELECT claim_invitation(repeat('i',43),repeat('c',43),now()+interval '15 minutes');
      SELECT create_auth_flow(repeat('c',43),repeat('f',43),now()+interval '15 minutes');
      SELECT bind_auth_identity(repeat('c',43),'${userId}');
      UPDATE invitation_claims SET expires_at=now()-interval '1 second';
      UPDATE auth_flows SET created_at=now()-interval '1 hour';
      UPDATE auth_flows SET expires_at=now()-interval '1 second';
      INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES('${userId}','learner@example.com',now());
      INSERT INTO auth.identities(id,user_id,provider)
      VALUES('email-identity','${userId}','email');
    `);
    await database.exec(await readFile(forwardUrl, "utf8"));

    await expect(
      database.query(`
        SELECT claim_invitation(repeat('i',43),repeat('n',43),now()+interval '15 minutes')::text AS id
      `),
    ).resolves.toMatchObject({ rows: [{ id: null }] });
    await expect(
      database.query("SELECT count(*)::integer AS count FROM invitation_claims"),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      database.query("SELECT count(*)::integer AS count FROM auth_flows"),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    await expect(
      database.query(`
        SELECT resume_interrupted_password_registration(
          repeat('i',43),'${userId}','learner@example.com','UTC',5
        )::text AS id
      `),
    ).resolves.toMatchObject({ rows: [{ id: userId }] });
    await expect(
      database.query(`
        SELECT
          (SELECT count(*) FROM user_profiles)::integer AS profiles,
          (SELECT count(*) FROM account_sign_in_methods WHERE method='password')::integer AS methods,
          (SELECT count(*) FROM quota_grants WHERE source='default')::integer AS quotas,
          (SELECT count(*) FROM invitations WHERE consumed_at IS NOT NULL)::integer AS invitations,
          (SELECT count(*) FROM invitation_claims WHERE finalized_user_id='${userId}')::integer AS claims,
          (SELECT count(*) FROM auth_flows WHERE consumed_at IS NOT NULL)::integer AS flows
      `),
    ).resolves.toMatchObject({
      rows: [{ claims: 1, flows: 1, invitations: 1, methods: 1, profiles: 1, quotas: 1 }],
    });
    await expect(
      database.query(`
        SELECT resume_interrupted_password_registration(
          repeat('i',43),'${userId}','learner@example.com','UTC',5
        )::text AS id
      `),
    ).resolves.toMatchObject({ rows: [{ id: null }] });
    await expect(
      database.query(`
        SELECT
          (SELECT count(*) FROM user_profiles)::integer AS profiles,
          (SELECT count(*) FROM quota_grants)::integer AS quotas
      `),
    ).resolves.toMatchObject({ rows: [{ profiles: 1, quotas: 1 }] });
  });

  it("reclaims only an expired unbound claim and cascades its abandoned flow", async () => {
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by)
      VALUES('${invitationId}',repeat('i',43),now()+interval '1 day','53000000-0000-4000-8000-000000000001');
      SELECT claim_invitation(repeat('i',43),repeat('c',43),now()+interval '15 minutes');
      SELECT create_auth_flow(repeat('c',43),repeat('f',43),now()+interval '15 minutes');
      UPDATE invitation_claims SET expires_at=now()-interval '1 second';
      UPDATE auth_flows SET created_at=now()-interval '1 hour';
      UPDATE auth_flows SET expires_at=now()-interval '1 second';
    `);
    await database.exec(await readFile(forwardUrl, "utf8"));

    await expect(
      database.query(`
        SELECT claim_invitation(
          repeat('i',43),repeat('n',43),now()+interval '15 minutes'
        )::text AS id
      `),
    ).resolves.toMatchObject({ rows: [{ id: invitationId }] });
    await expect(
      database.query(`
        SELECT
          (SELECT count(*) FROM invitation_claims)::integer AS claims,
          (SELECT count(*) FROM invitation_claims WHERE ticket_hash=repeat('n',43))::integer AS fresh,
          (SELECT count(*) FROM auth_flows)::integer AS flows
      `),
    ).resolves.toMatchObject({ rows: [{ claims: 1, flows: 0, fresh: 1 }] });
  });

  it("grants recovery only to the context setter role", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    await expect(
      database.query(`
        SELECT
          has_function_privilege(
            'huayi_context_setter',
            'resume_interrupted_password_registration(text,uuid,text,text,integer)',
            'EXECUTE'
          ) AS context_setter,
          has_function_privilege(
            'huayi_business',
            'resume_interrupted_password_registration(text,uuid,text,text,integer)',
            'EXECUTE'
          ) AS business,
          has_function_privilege(
            'huayi_runtime',
            'resume_interrupted_password_registration(text,uuid,text,text,integer)',
            'EXECUTE'
          ) AS runtime
      `),
    ).resolves.toMatchObject({
      rows: [{ business: false, context_setter: true, runtime: false }],
    });
  });

  it("leaves no partial writes when provider identity or interruption shape does not match", async () => {
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by)
      VALUES('${invitationId}',repeat('i',43),now()+interval '1 day','53000000-0000-4000-8000-000000000001');
      SELECT claim_invitation(repeat('i',43),repeat('c',43),now()+interval '15 minutes');
      SELECT create_auth_flow(repeat('c',43),repeat('f',43),now()+interval '15 minutes');
      SELECT bind_auth_identity(repeat('c',43),'${userId}');
      UPDATE invitation_claims SET expires_at=now()-interval '1 second';
      UPDATE auth_flows SET created_at=now()-interval '1 hour';
      UPDATE auth_flows SET expires_at=now()-interval '1 second';
      INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES('${userId}','learner@example.com',now());
      INSERT INTO auth.identities(id,user_id,provider)
      VALUES('google-identity','${userId}','google');
    `);
    await database.exec(await readFile(forwardUrl, "utf8"));

    await expect(
      database.query(`
        SELECT resume_interrupted_password_registration(
          repeat('i',43),'${userId}','learner@example.com','UTC',5
        )::text AS id
      `),
    ).resolves.toMatchObject({ rows: [{ id: null }] });
    await expect(
      database.query(`
        SELECT
          (SELECT count(*) FROM user_profiles)::integer AS profiles,
          (SELECT count(*) FROM quota_grants)::integer AS quotas,
          (SELECT count(*) FROM invitations WHERE consumed_at IS NOT NULL)::integer AS consumed
      `),
    ).resolves.toMatchObject({ rows: [{ consumed: 0, profiles: 0, quotas: 0 }] });
  });
});
