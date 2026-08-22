import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0004-analysis-reservation-fallback.sql", import.meta.url);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260821030000_analysis_reservation_fallback.sql",
  import.meta.url,
);
const userId = "00000000-0000-0000-0000-00000000000a";
const requestId = "10000000-0000-0000-0000-000000000001";
const reservationId = "20000000-0000-0000-0000-000000000001";

describe("analysis reservation fallback migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const [apiMigration, supabaseMigration] = await Promise.all([
      readFile(forwardUrl, "utf8"),
      readFile(supabaseForwardUrl, "utf8"),
    ]);
    expect(supabaseMigration).toEqual(apiMigration);
  });

  it("exposes only the active leased reservation amount to the context setter", async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(baselineUrl, "utf8"));
    await database.exec(await readFile(forwardUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','owner@example.test','active','UTC',5);
      INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,
        limit_micro_usd,source)
      VALUES('30000000-0000-0000-0000-000000000001','${userId}','${userId}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        1000,'default');
      INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,
        reserved_micro_usd,status,expires_at)
      VALUES('${reservationId}','${userId}','${userId}','${requestId}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',100,'active',
        now()+interval '5 minutes');
      INSERT INTO analysis_requests(id,owner_user_id,idempotency_key,request_hash,unit_count,
        state,lease_token,lease_expires_at,reservation_id,recovery_ledger_id)
      VALUES('${requestId}','${userId}','key',repeat('a',64),1,'running','lease',
        now()+interval '4 minutes','${reservationId}',
        '40000000-0000-0000-0000-000000000001');
    `);

    const amount = await database.transaction(async (transaction) => {
      await transaction.exec("SET LOCAL ROLE huayi_context_setter");
      return transaction.query<{ amount: string }>(
        `SELECT analysis_reservation_amount($1,$2,$3,$4)::text AS amount`,
        [userId, requestId, "lease", reservationId],
      );
    });
    const privileges = await database.query<{
      business: boolean;
      context_setter: boolean;
      public_role: boolean;
    }>(`SELECT
      has_function_privilege('huayi_business',
        'analysis_reservation_amount(uuid,uuid,text,uuid)','EXECUTE') business,
      has_function_privilege('huayi_context_setter',
        'analysis_reservation_amount(uuid,uuid,text,uuid)','EXECUTE') context_setter,
      has_function_privilege('public',
        'analysis_reservation_amount(uuid,uuid,text,uuid)','EXECUTE') public_role`);

    expect(amount.rows).toEqual([{ amount: "100" }]);
    expect(privileges.rows).toEqual([
      { business: false, context_setter: true, public_role: false },
    ]);
  });
});
