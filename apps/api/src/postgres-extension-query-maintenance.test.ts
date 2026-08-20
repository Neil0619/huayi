import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresExtensionQueryMaintenance } from "./postgres-extension-query-maintenance.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const undispatchedId = "70000000-0000-0000-0000-00000000000a";
const dispatchedId = "70000000-0000-0000-0000-00000000000b";
const activeId = "70000000-0000-0000-0000-00000000000c";
const priceId = "80000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres ExtensionQuery maintenance", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let ledgerOrdinal: number;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction() {
        throw new Error("Tenant transactions are not used by maintenance.");
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    ledgerOrdinal = 0;
    await database.exec(`INSERT INTO user_profiles(
      user_id,owner_user_id,email,status,timezone,daily_goal
    ) VALUES
      ('${userA}','${userA}','a@example.test','active','UTC',5),
      ('${userB}','${userB}','b@example.test','active','UTC',5);
    INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
    VALUES
      ('90000000-0000-0000-0000-00000000000a','${userA}','${userA}',
        '2020-01-01T00:00:00Z','2030-01-01T00:00:00Z',1000000,'default'),
      ('90000000-0000-0000-0000-00000000000b','${userB}','${userB}',
        '2020-01-01T00:00:00Z','2030-01-01T00:00:00Z',1000000,'default');
    INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
      cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
    VALUES('${priceId}','deepseek','deepseek-v4-flash',2,1,3,'2020-01-01T00:00:00Z');
    INSERT INTO quota_reservations(
      id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at
    ) VALUES
      ('b0000000-0000-0000-0000-00000000000a','${userA}','${userA}','${undispatchedId}',
        '2020-01-01T00:00:00Z',400,'active','2020-01-01T00:02:00Z'),
      ('b0000000-0000-0000-0000-00000000000b','${userB}','${userB}','${dispatchedId}',
        '2020-01-01T00:00:00Z',500,'active','2020-01-01T00:02:00Z');
    INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      reservation_id,price_version_id,dispatched_at,expires_at,created_at,updated_at
    ) VALUES
      ('${undispatchedId}','${userA}','undispatched','${"a".repeat(64)}','running',
        '{"action":"translate","selectionKind":"sentence","sourceText":"private-a","sourceType":"web-selection"}',
        'lease-a','2020-01-01T00:02:00Z','b0000000-0000-0000-0000-00000000000a','${priceId}',
        NULL,'2030-01-01T01:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'),
      ('${dispatchedId}','${userB}','dispatched','${"b".repeat(64)}','running',
        '{"action":"explain","selectionKind":"sentence","sourceText":"private-b","sourceType":"web-selection"}',
        'lease-b','2020-01-01T00:02:00Z','b0000000-0000-0000-0000-00000000000b','${priceId}',
        '2020-01-01T00:01:00Z','2030-01-01T01:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'),
      ('${activeId}','${userA}','active','${"c".repeat(64)}','running',
        '{"action":"translate","selectionKind":"sentence","sourceText":"active-private","sourceType":"web-selection"}',
        'lease-c','2030-01-01T00:02:00Z',NULL,NULL,NULL,
        '2020-01-01T01:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z');
    INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      terminal_event,expires_at,created_at,updated_at
    ) SELECT md5('expired-terminal-' || value::text)::uuid,'${userA}',
      'expired-terminal-' || value::text,'${"d".repeat(64)}','failed','{}','expired-lease',
      '2020-01-01T00:02:00Z','{}','2020-01-01T01:00:00Z',
      '2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
      FROM generate_series(1,101) value;`);
  });

  afterEach(async () => database.close());

  it("safely abandons expired leases and hard-deletes at most 100 terminal rows", async () => {
    const createMaintenance = () =>
      createPostgresExtensionQueryMaintenance({
        database: adapter,
        ledgerId: () => {
          ledgerOrdinal += 1;
          return `a0000000-0000-4000-8000-${ledgerOrdinal.toString().padStart(12, "0")}`;
        },
      });

    const results = await Promise.all([
      createMaintenance().runBatch(),
      createMaintenance().runBatch(),
    ]);

    expect(results.reduce((sum, result) => sum + result.abandonedCount, 0)).toBe(2);
    expect(results.every((result) => result.deletedCount <= 100)).toBe(true);
    expect(results.reduce((sum, result) => sum + result.deletedCount, 0)).toBe(101);
    expect(
      (
        await database.query<{ state: string }>(
          "SELECT state FROM extension_query_generations WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[undispatchedId, dispatchedId]],
        )
      ).rows,
    ).toEqual([{ state: "failed" }, { state: "failed" }]);
    expect(
      (
        await database.query<{ status: string }>(
          "SELECT status FROM quota_reservations ORDER BY id",
        )
      ).rows,
    ).toEqual([{ status: "released" }, { status: "settled" }]);
    expect(
      (
        await database.query<{ cost_micro_usd: string; request_id: string }>(
          "SELECT request_id::text,cost_micro_usd::text FROM usage_ledger",
        )
      ).rows,
    ).toEqual([{ cost_micro_usd: "500", request_id: dispatchedId }]);
    expect(
      (
        await database.query<{ state: string }>(
          "SELECT state FROM extension_query_generations WHERE id=$1",
          [activeId],
        )
      ).rows,
    ).toEqual([{ state: "running" }]);
  });
});
