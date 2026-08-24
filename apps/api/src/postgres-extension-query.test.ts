import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";
import { createPostgresExtensionQueryStore } from "./postgres-extension-query.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const generationId = "70000000-0000-0000-0000-00000000000a";
const priceId = "80000000-0000-0000-0000-00000000000a";

function queryCommand(options: { idempotencyKey?: string; requestHash?: string } = {}) {
  return {
    expiresAt: new Date("2026-08-13T01:00:00.000Z"),
    id: generationId,
    idempotencyKey: options.idempotencyKey ?? "query-key",
    input: {
      action: "explain" as const,
      selectionKind: "sentence" as const,
      sourceText: "The plan fell through.",
      sourceType: "web-selection" as const,
    },
    leaseExpiresAt: new Date("2026-08-13T00:02:00.000Z"),
    leaseToken: "lease-token-1",
    requestHash: options.requestHash ?? "a".repeat(64),
    userId: userA,
  };
}

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres ExtensionQuery authority", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let now: Date;
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
        return operation(query(database));
      },
    };
    now = new Date("2026-08-13T00:00:00.000Z");
    await database.exec(`INSERT INTO user_profiles(
      user_id,owner_user_id,email,status,timezone,daily_goal
    ) VALUES
      ('${userA}','${userA}','a@example.test','active','UTC',5),
      ('${userB}','${userB}','b@example.test','active','UTC',5);
    INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
    VALUES('90000000-0000-0000-0000-00000000000a','${userA}','${userA}',
      '2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',1000000,'default');
    INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
      cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
    VALUES('${priceId}','deepseek','deepseek-v4-flash',2,1,3,'2026-08-01T00:00:00Z');`);
  });
  afterEach(async () => database.close());

  it("claims once, rejects key conflicts, settles a terminal result, and isolates owners", async () => {
    const store = createPostgresExtensionQueryStore({
      database: adapter,
      ledgerId: () => "a0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
    });
    const command = queryCommand();
    await expect(store.begin(command)).resolves.toMatchObject({ kind: "acquired" });
    await expect(store.begin(command)).resolves.toEqual({ id: generationId, kind: "running" });
    await expect(store.begin({ ...command, requestHash: "b".repeat(64) })).rejects.toMatchObject({
      code: "idempotency_conflict",
    });

    const quota = createPostgresAnalysisQuota({
      database: adapter,
      expiresAt: () => new Date("2026-08-13T00:05:00.000Z"),
      id: () => "b0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
      prices: {
        cachedInputMicroUsdPerMillionTokens: 1,
        inputMicroUsdPerMillionTokens: 2,
        outputMicroUsdPerMillionTokens: 3,
      },
      providerModel: "deepseek-v4-flash",
    });
    const reservation = await quota.reserve({
      requestId: generationId,
      reservedMicroUsd: 500,
      userId: userA,
    });
    await store.attachReservation({
      id: generationId,
      leaseToken: command.leaseToken,
      priceVersionId: priceId,
      reservationId: reservation.id,
      userId: userA,
    });
    const result = {
      contextRole: "谓语",
      keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
      mainStructure: "主语 + 谓语",
      requestId: generationId,
      selectionKind: "sentence" as const,
      sourceText: command.input.sourceText,
      translationZh: "计划落空了。",
      type: "explain-sentence" as const,
    };
    await expect(
      store.complete({
        costMicroUsd: 100,
        id: generationId,
        leaseToken: command.leaseToken,
        reservationId: reservation.id,
        result,
        usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
        userId: userA,
      }),
    ).resolves.toMatchObject({ result, type: "query.completed" });
    await expect(store.find(userA, generationId)).resolves.toMatchObject({
      result,
      state: "completed",
    });
    await expect(store.find(userB, generationId)).resolves.toBeNull();
    const ledger = await database.query<{ feature: string }>(
      "SELECT feature FROM usage_ledger WHERE request_id=$1",
      [generationId],
    );
    expect(ledger.rows).toEqual([{ feature: "extension-query" }]);
  });

  it("conservatively settles the reservation when a dispatched failure has no usage", async () => {
    const store = createPostgresExtensionQueryStore({
      database: adapter,
      ledgerId: () => "a0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
    });
    const command = queryCommand({
      idempotencyKey: "query-failure-key",
      requestHash: "c".repeat(64),
    });
    await expect(store.begin(command)).resolves.toMatchObject({ kind: "acquired" });
    const quota = createPostgresAnalysisQuota({
      database: adapter,
      expiresAt: () => new Date("2026-08-13T00:05:00.000Z"),
      id: () => "b0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
    });
    const reservation = await quota.reserve({
      requestId: generationId,
      reservedMicroUsd: 500,
      userId: userA,
    });
    await store.attachReservation({
      id: generationId,
      leaseToken: command.leaseToken,
      priceVersionId: priceId,
      reservationId: reservation.id,
      userId: userA,
    });
    await store.markDispatched({
      id: generationId,
      leaseToken: command.leaseToken,
      userId: userA,
    });
    const error = {
      code: "model_unavailable" as const,
      message: "The model is temporarily unavailable.",
      requestId: generationId,
    };
    const unrelatedReservationId = "b0000000-0000-0000-0000-00000000000b";
    await database.query(
      `INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,
       reserved_micro_usd,status,expires_at) VALUES($1,$2,$2,$3,'2026-08-01T00:00:00Z',
       400,'active','2026-08-13T00:05:00Z')`,
      [unrelatedReservationId, userB, "70000000-0000-0000-0000-00000000000b"],
    );
    await expect(
      store.fail({
        billedCalls: [
          { costMicroUsd: 23, usage: { cachedInputTokens: 1, inputTokens: 8, outputTokens: 3 } },
        ],
        error,
        id: generationId,
        leaseToken: command.leaseToken,
        reservationId: unrelatedReservationId,
        userId: userA,
      }),
    ).rejects.toThrow("query lease lost");

    await expect(
      store.fail({
        error,
        id: generationId,
        leaseToken: command.leaseToken,
        reservationId: reservation.id,
        userId: userA,
      }),
    ).resolves.toMatchObject({ type: "query.failed" });

    const rows = await database.query<{
      cached_input_tokens: string | null;
      cost_micro_usd: string;
      input_tokens: string | null;
      output_tokens: string | null;
      status: string;
    }>(
      `SELECT ledger.cached_input_tokens::text,ledger.cost_micro_usd::text,
        ledger.input_tokens::text,ledger.output_tokens::text,reservations.status
       FROM usage_ledger ledger JOIN quota_reservations reservations
         ON reservations.request_id=ledger.request_id WHERE ledger.request_id=$1`,
      [generationId],
    );
    expect(rows.rows).toEqual([
      {
        cached_input_tokens: null,
        cost_micro_usd: "500",
        input_tokens: null,
        output_tokens: null,
        status: "settled",
      },
    ]);
  });

  it("hard-deletes expired query input and result while leaving usage ledger authority", async () => {
    const store = createPostgresExtensionQueryStore({
      database: adapter,
      ledgerId: () => "a0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
    });
    await database.exec(`INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      terminal_event,expires_at,created_at,updated_at
    ) VALUES('${generationId}','${userA}','query-key','${"a".repeat(64)}','completed',
      '{"action":"translate","selectionKind":"sentence","sourceText":"private","sourceType":"web-selection"}',
      'lease','2026-08-13T00:02:00Z',
      '{"generationId":"${generationId}","type":"query.started"}',
      '2026-08-13T01:00:00Z','2026-08-13T00:00:00Z','2026-08-13T00:00:00Z');`);
    now = new Date("2026-08-13T01:00:00.000Z");

    await expect(store.find(userA, generationId)).resolves.toBeNull();
    const rows = await database.query("SELECT id FROM extension_query_generations WHERE id=$1", [
      generationId,
    ]);
    expect(rows.rows).toEqual([]);
  });

  it("does not hard-delete an expired running query before safe terminalization", async () => {
    await database.exec(`INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      dispatched_at,expires_at,created_at,updated_at
    ) VALUES('${generationId}','${userA}','query-key','${"a".repeat(64)}','running',
      '{"action":"translate","selectionKind":"sentence","sourceText":"private","sourceType":"web-selection"}',
      'lease','2026-08-13T00:02:00Z',NULL,
      '2026-08-13T01:00:00Z','2026-08-13T00:00:00Z','2026-08-13T00:00:00Z');`);
    now = new Date("2026-08-13T01:00:00.000Z");
    const store = createPostgresExtensionQueryStore({
      database: adapter,
      ledgerId: () => "a0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
    });

    await expect(store.find(userA, generationId)).resolves.toMatchObject({ state: "running" });
    expect(
      (
        await database.query<{ state: string }>(
          "SELECT state FROM extension_query_generations WHERE id=$1",
          [generationId],
        )
      ).rows,
    ).toEqual([{ state: "running" }]);
  });

  it("fences an expired worker and conservatively settles its ambiguous reservation", async () => {
    const reservationId = "b0000000-0000-0000-0000-00000000000a";
    await database.exec(`INSERT INTO quota_reservations(
      id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at
    ) VALUES('${reservationId}','${userA}','${userA}','${generationId}',
      '2026-08-01T00:00:00Z',500,'active','2026-08-13T00:02:00Z');
    INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      reservation_id,price_version_id,expires_at,created_at,updated_at
    ) VALUES('${generationId}','${userA}','query-key','${"a".repeat(64)}','running',
      '{"action":"translate","selectionKind":"sentence","sourceText":"private","sourceType":"web-selection"}',
      'old-lease','2026-08-13T00:02:00Z','${reservationId}','${priceId}',
      '2026-08-13T01:00:00Z','2026-08-13T00:00:00Z','2026-08-13T00:00:00Z');`);
    await database.exec(
      `UPDATE extension_query_generations SET dispatched_at='2026-08-13T00:01:00Z' WHERE id='${generationId}'`,
    );
    now = new Date("2026-08-13T00:03:00.000Z");
    const store = createPostgresExtensionQueryStore({
      database: adapter,
      ledgerId: () => "a0000000-0000-0000-0000-00000000000a",
      now: () => now,
      priceVersionId: priceId,
    });

    await expect(
      store.begin({
        expiresAt: new Date("2026-08-13T01:00:00.000Z"),
        id: "70000000-0000-0000-0000-00000000000b",
        idempotencyKey: "query-key",
        input: {
          action: "translate",
          selectionKind: "sentence",
          sourceText: "private",
          sourceType: "web-selection",
        },
        leaseExpiresAt: new Date("2026-08-13T00:05:00.000Z"),
        leaseToken: "new-lease",
        requestHash: "a".repeat(64),
        userId: userA,
      }),
    ).resolves.toEqual({ id: generationId, kind: "expired" });
    await expect(store.abandon(userA, generationId)).resolves.toMatchObject({
      type: "query.failed",
    });
    const rows = await database.query<{ cost_micro_usd: string; status: string }>(
      `SELECT ledger.cost_micro_usd::text,reservations.status FROM usage_ledger ledger
       JOIN quota_reservations reservations ON reservations.request_id=ledger.request_id
       WHERE ledger.request_id=$1`,
      [generationId],
    );
    expect(rows.rows).toEqual([{ cost_micro_usd: "500", status: "settled" }]);
  });

  it("releases an expired undispatched reservation without writing usage", async () => {
    const reservationId = "b0000000-0000-0000-0000-00000000000b";
    await database.exec(`INSERT INTO quota_reservations(
      id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at
    ) VALUES('${reservationId}','${userA}','${userA}','${generationId}',
      '2026-08-01T00:00:00Z',500,'active','2026-08-13T00:02:00Z');
    INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      reservation_id,price_version_id,expires_at,created_at,updated_at
    ) VALUES('${generationId}','${userA}','query-key','${"a".repeat(64)}','running',
      '{"action":"translate","selectionKind":"sentence","sourceText":"private","sourceType":"web-selection"}',
      'old-lease','2026-08-13T00:02:00Z','${reservationId}','${priceId}',
      '2026-08-13T01:00:00Z','2026-08-13T00:00:00Z','2026-08-13T00:00:00Z');`);
    now = new Date("2026-08-13T00:03:00.000Z");
    const store = createPostgresExtensionQueryStore({
      database: adapter,
      ledgerId: () => "a0000000-0000-0000-0000-00000000000b",
      now: () => now,
      priceVersionId: priceId,
    });

    await expect(store.abandon(userA, generationId)).resolves.toMatchObject({
      type: "query.failed",
    });
    expect(
      (await database.query("SELECT 1 FROM usage_ledger WHERE request_id=$1", [generationId])).rows,
    ).toEqual([]);
    expect(
      (
        await database.query<{ status: string }>(
          "SELECT status FROM quota_reservations WHERE id=$1",
          [reservationId],
        )
      ).rows,
    ).toEqual([{ status: "released" }]);
  });
});
