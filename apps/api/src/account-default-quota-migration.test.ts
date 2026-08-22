import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0002-account-default-quota.sql", import.meta.url);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260821010000_account_default_quota.sql",
  import.meta.url,
);
const localSeedUrl = new URL("../../../supabase/seed.sql", import.meta.url);

const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const userC = "00000000-0000-0000-0000-00000000000c";

async function databaseAtBaseline() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(await readFile(baselineUrl, "utf8"));
  return database;
}

describe("account default quota forward migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const [apiForward, supabaseForward] = await Promise.all([
      readFile(forwardUrl, "utf8"),
      readFile(supabaseForwardUrl, "utf8"),
    ]);
    expect(supabaseForward).toEqual(apiForward);
  });

  it("backfills only missing non-deleting accounts without replacing an admin grant", async () => {
    database = await databaseAtBaseline();
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES
        ('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','disabled','UTC',5),
        ('${userC}','${userC}','c@example.test','deleting','UTC',5);
      INSERT INTO quota_grants(
        id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
      ) VALUES(
        '10000000-0000-4000-8000-000000000001','${userB}','${userB}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        250000,'admin'
      );
    `);

    await database.exec(await readFile(forwardUrl, "utf8"));

    const grants = await database.query<{
      limit_micro_usd: string;
      period_is_current: boolean;
      source: string;
      user_id: string;
    }>(`
      SELECT user_id::text,limit_micro_usd::text,source,
        period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND period_end=(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')
            AT TIME ZONE 'UTC' AS period_is_current
      FROM quota_grants WHERE superseded_at IS NULL ORDER BY user_id
    `);
    expect(grants.rows).toEqual([
      {
        limit_micro_usd: "1000000",
        period_is_current: true,
        source: "default",
        user_id: userA,
      },
      {
        limit_micro_usd: "250000",
        period_is_current: true,
        source: "admin",
        user_id: userB,
      },
    ]);

    const privileges = await database.query<{
      business: boolean;
      context_setter: boolean;
      public_role: boolean;
      runtime: boolean;
    }>(`
      SELECT
        has_function_privilege('huayi_business','ensure_current_default_quota(uuid,timestamptz)','EXECUTE')
          AS business,
        has_function_privilege('huayi_context_setter','ensure_current_default_quota(uuid,timestamptz)','EXECUTE')
          AS context_setter,
        has_function_privilege('public','ensure_current_default_quota(uuid,timestamptz)','EXECUTE')
          AS public_role,
        has_function_privilege('huayi_runtime','ensure_current_default_quota(uuid,timestamptz)','EXECUTE')
          AS runtime
    `);
    expect(privileges.rows).toEqual([
      { business: false, context_setter: false, public_role: false, runtime: false },
    ]);
  });

  it("creates one current-month grant for password and Google invitation registration", async () => {
    database = await databaseAtBaseline();
    await database.exec(await readFile(forwardUrl, "utf8"));
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by) VALUES
        ('20000000-0000-4000-8000-000000000001','password-token',now()+interval '72 hours','${userC}'),
        ('20000000-0000-4000-8000-000000000002','google-token',now()+interval '72 hours','${userC}');
      SELECT claim_invitation('password-token','password-ticket',now()+interval '15 minutes');
      SELECT bind_auth_identity('password-ticket','${userA}');
      SELECT finalize_invitation(
        'password-ticket','${userA}','a@example.test','UTC',5,'password'
      );
      SELECT finalize_invitation(
        'password-ticket','${userA}','a@example.test','UTC',5,'password'
      );
      SELECT claim_invitation('google-token','google-ticket',now()+interval '15 minutes');
      SELECT create_auth_flow('google-ticket','google-flow',now()+interval '15 minutes');
      SELECT complete_auth_flow('google-flow','${userB}','b@example.test','UTC',5);
      SELECT complete_auth_flow('google-flow','${userB}','b@example.test','UTC',5);
    `);

    const grants = await database.query<{
      count: number;
      limit_micro_usd: string;
      source: string;
      user_id: string;
    }>(`
      SELECT user_id::text,limit_micro_usd::text,source,count(*)::integer AS count
      FROM quota_grants WHERE superseded_at IS NULL
      GROUP BY user_id,limit_micro_usd,source ORDER BY user_id
    `);
    expect(grants.rows).toEqual([
      { count: 1, limit_micro_usd: "1000000", source: "default", user_id: userA },
      { count: 1, limit_micro_usd: "1000000", source: "default", user_id: userB },
    ]);
  });

  it("rebuilds only the fictional operator and its default grant from the local seed", async () => {
    database = await databaseAtBaseline();
    await database.exec(await readFile(forwardUrl, "utf8"));
    await database.exec(await readFile(localSeedUrl, "utf8"));

    const state = await database.query<{
      grants: number;
      invitations: number;
      methods: number;
      operators: number;
      profiles: number;
      sessions: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM user_profiles) AS profiles,
        (SELECT count(*)::integer FROM admin_roles WHERE role='operator') AS operators,
        (SELECT count(*)::integer FROM quota_grants
          WHERE source='default' AND limit_micro_usd=1000000 AND superseded_at IS NULL) AS grants,
        (SELECT count(*)::integer FROM account_sign_in_methods) AS methods,
        (SELECT count(*)::integer FROM invitations) AS invitations,
        (SELECT count(*)::integer FROM web_sessions) AS sessions
    `);
    expect(state.rows).toEqual([
      { grants: 1, invitations: 0, methods: 0, operators: 1, profiles: 1, sessions: 0 },
    ]);
  });
});
