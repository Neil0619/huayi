import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresExtensionQueryStore } from "./postgres-extension-query.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { structuredQueryFixture } from "./test-support/structured-query-fixture.js";

const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const id = "70000000-0000-0000-0000-000000000001";
const price = "80000000-0000-0000-0000-000000000001";
const reservationId = "90000000-0000-0000-0000-000000000001";
const now = new Date("2026-08-13T00:00:00Z");
const input = {
  action: "explain" as const,
  selectionKind: "sentence" as const,
  sourceText: "We can.",
  sourceType: "web-selection" as const,
};
const command = {
  userId: owner,
  id,
  idempotencyKey: "query",
  input,
  requestHash: "a".repeat(64),
  leaseToken: "valid-lease",
  leaseExpiresAt: new Date("2026-08-13T00:02:00Z"),
  expiresAt: new Date("2026-08-13T01:00:00Z"),
};
let database: PGlite;
beforeEach(async () => {
  database = new PGlite();
  await database.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'test@example.test','active','UTC',5)",
    [owner],
  );
  await database.query(
    "INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source) VALUES($1,$2,$2,'2026-08-01','2026-09-01',1000000,'default')",
    [reservationId, owner],
  );
  await database.query(
    "INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from) VALUES($1,'deepseek','deepseek-v4-flash',2,1,3,'2026-08-01')",
    [price],
  );
});
afterEach(async () => database.close());

async function setup() {
  const store = createPostgresExtensionQueryStore({
    database: createPgliteAnalysisDatabase(database),
    ledgerId: () => "a0000000-0000-0000-0000-000000000001",
    now: () => now,
    priceVersionId: price,
  });
  await store.begin(command);
  await database.query(
    "INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at) VALUES($1,$2,$2,$3,'2026-08-01',500,'active','2026-08-13T00:05:00Z')",
    [reservationId, owner, id],
  );
  await store.attachReservation({
    id,
    userId: owner,
    leaseToken: command.leaseToken,
    reservationId,
    priceVersionId: price,
  });
  await store.markDispatched({ id, userId: owner, leaseToken: command.leaseToken });
  return store;
}

describe("structured query storage and lease fencing", () => {
  it("stores and replays a native completion once, with owner isolation and its original ledger", async () => {
    const store = await setup();
    const result = structuredQueryFixture(id);
    const completed = await store.complete({
      id,
      userId: owner,
      leaseToken: command.leaseToken,
      reservationId,
      result,
      usage: { cachedInputTokens: 0, inputTokens: 2, outputTokens: 3 },
      costMicroUsd: 17,
    });
    expect(completed).toMatchObject({
      type: "query.completed",
      result,
      quota: { usedMicroUsd: 17 },
    });
    expect(await store.find(owner, id)).toMatchObject({ state: "completed", result });
    expect(await store.find(other, id)).toBeNull();
    expect(await store.begin(command)).toEqual({ kind: "terminal", id, event: completed });
    expect(
      (
        await database.query(
          "SELECT cost_micro_usd::text AS cost FROM usage_ledger WHERE request_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ cost: "17" }]);
  });

  it.each(["complete", "fail"] as const)(
    "rejects a wrong lease before %s can settle or mutate a generation",
    async (operation) => {
      const store = await setup();
      const common = {
        id,
        userId: owner,
        leaseToken: "wrong-token",
        reservationId,
        usage: { cachedInputTokens: 0, inputTokens: 2, outputTokens: 3 },
        costMicroUsd: 17,
      };
      await expect(
        operation === "complete"
          ? store.complete({ ...common, result: structuredQueryFixture(id) })
          : store.fail({
              ...common,
              error: { code: "model_unavailable", message: "Unavailable", requestId: id },
            }),
      ).rejects.toThrow("query lease lost");
      expect(
        (await database.query("SELECT 1 FROM usage_ledger WHERE request_id=$1", [id])).rows,
      ).toEqual([]);
      expect(
        (await database.query("SELECT status FROM quota_reservations WHERE id=$1", [reservationId]))
          .rows,
      ).toEqual([{ status: "active" }]);
      expect(await store.find(owner, id)).toMatchObject({ state: "running" });
    },
  );
});
