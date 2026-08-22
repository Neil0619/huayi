import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisStore } from "./postgres-analysis-store.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";
const requestId = "40000000-0000-0000-0000-000000000001";
const reservationId = "30000000-0000-0000-0000-000000000001";
const priceId = "50000000-0000-0000-0000-000000000001";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres analysis store failure fallback", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          return operation({
            tenant: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return query(transaction).rows(text, parameters);
              },
            },
            trusted: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_context_setter");
                return query(transaction).rows(text, parameters);
              },
            },
          });
        });
      },
      async trusted(operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          return operation(query(transaction));
        });
      },
    };
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','owner@example.test','active','UTC',5);
      INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
        cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
      VALUES('${priceId}','deepseek','fake',1,1,1,now());
      INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,
        limit_micro_usd,source)
      VALUES('60000000-0000-0000-0000-000000000001','${userId}','${userId}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        1000,'default');
      INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,
        reserved_micro_usd,status,expires_at)
      VALUES('${reservationId}','${userId}','${userId}','${requestId}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',100,'active',
        now()+interval '5 minutes');
      INSERT INTO analysis_requests(id,owner_user_id,idempotency_key,request_hash,unit_count,
        state,lease_token,lease_expires_at,reservation_id,price_version_id,recovery_ledger_id)
      VALUES('${requestId}','${userId}','key',repeat('a',64),1,'running','lease',
        now()+interval '4 minutes','${reservationId}','${priceId}',
        '70000000-0000-0000-0000-000000000001');
    `);
  });

  afterEach(async () => database.close());

  it("uses the active reservation as the conservative amount for an unpriced failure", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "72000000-0000-0000-0000-000000000001",
      priceVersionId: priceId,
    });

    await expect(
      store.fail({
        error: { code: "model_unavailable", message: "Unavailable.", requestId },
        leaseToken: "lease",
        requestId,
        reservationId,
        userId,
      }),
    ).resolves.toMatchObject({ type: "analysis.failed" });

    const state = await database.query<{
      cost_micro_usd: string;
      request_state: string;
      status: string;
    }>(`SELECT ledger.cost_micro_usd::text,requests.state request_state,reservations.status
      FROM usage_ledger ledger
      JOIN analysis_requests requests ON requests.id=ledger.request_id
      JOIN quota_reservations reservations ON reservations.id=requests.reservation_id
      WHERE requests.id='${requestId}'`);
    expect(state.rows).toEqual([
      { cost_micro_usd: "100", request_state: "failed", status: "settled" },
    ]);
  });
});
