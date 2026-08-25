import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

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
];
const migrationUrls = migrationNames.map(
  (name) => new URL(`../migrations/${name}`, import.meta.url),
);
const forwardUrl = new URL(
  "../migrations/0010-quota-lifecycle-and-model-rate-limit.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260822010000_quota_lifecycle_and_model_rate_limit.sql",
  import.meta.url,
);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

async function migratedDatabase() {
  const database = new PGlite();
  await database.waitReady;
  for (const migrationUrl of migrationUrls) {
    await database.exec(await readFile(migrationUrl, "utf8"));
  }
  await database.exec(`
    INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES
      ('${userA}','${userA}','a@example.test','active','UTC',5),
      ('${userB}','${userB}','b@example.test','active','UTC',5);
  `);
  return database;
}

describe("account quota lifecycle and production model rate-limit migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const [apiForward, supabaseForward] = await Promise.all([
      readFile(forwardUrl, "utf8"),
      readFile(supabaseForwardUrl, "utf8"),
    ]);
    expect(supabaseForward).toEqual(apiForward);
  });

  it("creates each missing UTC month default without replacing that month admin grant", async () => {
    database = await migratedDatabase();
    await database.exec(`
      INSERT INTO quota_grants(
        id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
      ) VALUES(
        '10000000-0000-4000-8000-000000000001','${userB}','${userB}',
        '2040-02-01T00:00:00Z','2040-03-01T00:00:00Z',250000,'admin'
      );
    `);
    await database.transaction(async (transaction) => {
      await transaction.query("SELECT huayi_private.set_owner_context($1)", [userA]);
      await transaction.query("SELECT ensure_owner_current_default_quota($1,$2)", [
        userA,
        "2040-02-15T12:00:00Z",
      ]);
      await transaction.query("SELECT ensure_owner_current_default_quota($1,$2)", [
        userA,
        "2040-02-16T12:00:00Z",
      ]);
    });
    await database.transaction(async (transaction) => {
      await transaction.query("SELECT huayi_private.set_owner_context($1)", [userB]);
      await transaction.query("SELECT ensure_owner_current_default_quota($1,$2)", [
        userB,
        "2040-02-15T12:00:00Z",
      ]);
    });
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query("SELECT huayi_private.set_owner_context($1)", [userA]);
        await transaction.query("SELECT ensure_owner_current_default_quota($1,$2)", [
          userB,
          "2040-03-15T12:00:00Z",
        ]);
      }),
    ).rejects.toThrow(/quota owner mismatch/iu);

    const grants = await database.query<{
      count: number;
      limit_micro_usd: string;
      source: string;
      user_id: string;
    }>(`
      SELECT user_id::text,limit_micro_usd::text,source,count(*)::integer AS count
      FROM quota_grants WHERE period_start='2040-02-01T00:00:00Z' AND superseded_at IS NULL
      GROUP BY user_id,limit_micro_usd,source ORDER BY user_id
    `);
    expect(grants.rows).toEqual([
      { count: 1, limit_micro_usd: "1000000", source: "default", user_id: userA },
      { count: 1, limit_micro_usd: "250000", source: "admin", user_id: userB },
    ]);
  }, 15_000);

  it("shares persistent rolling 60/hour and 300/day limits without double-counting replay", async () => {
    database = await migratedDatabase();
    await database.exec(`
      SELECT reserve_quota(
        '20000000-0000-4000-8000-000000000001','${userA}',
        '30000000-0000-4000-8000-000000000001',1,now()+interval '2 minutes'
      );
      INSERT INTO model_rate_limit_events(owner_user_id,request_id,occurred_at)
      SELECT '${userA}',gen_random_uuid(),now()-interval '1 minute'
      FROM generate_series(1,59);
    `);

    await expect(
      database.query(`SELECT reserve_quota(
        '20000000-0000-4000-8000-000000000099','${userA}',
        '30000000-0000-4000-8000-000000000001',1,now()+interval '2 minutes'
      )::text AS id`),
    ).resolves.toMatchObject({
      rows: [{ id: "20000000-0000-4000-8000-000000000001" }],
    });
    await expect(
      database.exec(`SELECT reserve_quota(
        '20000000-0000-4000-8000-000000000002','${userA}',
        '30000000-0000-4000-8000-000000000002',1,now()+interval '2 minutes'
      )`),
    ).rejects.toThrow(/model rate limited/iu);

    const afterHourly = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM model_rate_limit_events
      WHERE owner_user_id='${userA}'
    `);
    expect(afterHourly.rows).toEqual([{ count: 60 }]);

    const currentGrant = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM quota_grants
      WHERE user_id='${userA}' AND source='default' AND superseded_at IS NULL
        AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    `);
    expect(currentGrant.rows).toEqual([{ count: 1 }]);

    await database.exec(`
      DELETE FROM model_rate_limit_events WHERE owner_user_id='${userA}';
      INSERT INTO model_rate_limit_events(owner_user_id,request_id,occurred_at)
      SELECT '${userA}',gen_random_uuid(),now()-interval '2 hours'
      FROM generate_series(1,300);
    `);
    await expect(
      database.exec(`SELECT reserve_quota(
        '20000000-0000-4000-8000-000000000003','${userA}',
        '30000000-0000-4000-8000-000000000003',1,now()+interval '2 minutes'
      )`),
    ).rejects.toThrow(/model rate limited/iu);
  });

  it("keeps rate-limit and exhausted quota as distinct failures", async () => {
    database = await migratedDatabase();
    await database.exec(`
      SELECT replace_quota_grant(
        '10000000-0000-4000-8000-000000000002','${userA}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        0,'admin'
      );
    `);
    await expect(
      database.exec(`SELECT reserve_quota(
        '20000000-0000-4000-8000-000000000004','${userA}',
        '30000000-0000-4000-8000-000000000004',1,now()+interval '2 minutes'
      )`),
    ).rejects.toThrow(/quota exhausted/iu);
    const rateEvents = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM model_rate_limit_events
      WHERE owner_user_id='${userA}'
    `);
    expect(rateEvents.rows).toEqual([{ count: 0 }]);
  });

  it("does not widen forced-RLS table or function grants", async () => {
    database = await migratedDatabase();
    const state = await database.query<{
      business_table: boolean;
      context_function: boolean;
      forced: boolean;
      public_function: boolean;
      public_table: boolean;
      runtime_function: boolean;
    }>(`
      SELECT
        relforcerowsecurity AS forced,
        has_table_privilege('public','model_rate_limit_events','SELECT') AS public_table,
        has_table_privilege('huayi_business','model_rate_limit_events','SELECT') AS business_table,
        has_function_privilege(
          'public','ensure_owner_current_default_quota(uuid,timestamptz)','EXECUTE'
        ) AS public_function,
        has_function_privilege(
          'huayi_context_setter','ensure_owner_current_default_quota(uuid,timestamptz)','EXECUTE'
        ) AS context_function,
        has_function_privilege(
          'huayi_runtime','ensure_owner_current_default_quota(uuid,timestamptz)','EXECUTE'
        ) AS runtime_function
      FROM pg_class WHERE oid='model_rate_limit_events'::regclass
    `);
    expect(state.rows).toEqual([
      {
        business_table: false,
        context_function: true,
        forced: true,
        public_function: false,
        public_table: false,
        runtime_function: false,
      },
    ]);
  });
});
