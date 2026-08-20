import { readFile } from "node:fs/promises";

import { contractFixtures, analysisRecordSchema } from "@huayi/cloud-contracts";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisStore } from "./postgres-analysis-store.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const analysisId = "10000000-0000-0000-0000-000000000001";
const candidateId = "20000000-0000-0000-0000-000000000001";
const reservationId = "30000000-0000-0000-0000-000000000001";
const requestId = "40000000-0000-0000-0000-000000000001";
const priceId = "50000000-0000-0000-0000-000000000001";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres analysis store", () => {
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
          const tenant = query(transaction);
          const trusted = query(transaction);
          return operation({
            tenant: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return tenant.rows(text, parameters);
              },
            },
            trusted: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_context_setter");
                return trusted.rows(text, parameters);
              },
            },
          });
        });
      },
      async trusted(operation) {
        return database.transaction((transaction) => operation(query(transaction)));
      },
    };
    await database.exec(`INSERT INTO user_profiles (user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','active','UTC',5);
      INSERT INTO model_price_versions (id,provider,model,input_micro_usd_per_million,
        cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
      VALUES ('${priceId}','deepseek','fake',1,1,1,now());
      INSERT INTO quota_grants (id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
      VALUES ('60000000-0000-0000-0000-000000000001','${userA}','${userA}',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',1000,'default');
      INSERT INTO quota_reservations (id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at)
      VALUES ('${reservationId}','${userA}','${userA}','${requestId}',date_trunc('month',now()),100,'active',now()+interval '2 minutes');
      INSERT INTO analysis_requests (id,owner_user_id,idempotency_key,request_hash,unit_count,state,
        lease_token,lease_expires_at,reservation_id,price_version_id,recovery_ledger_id)
      VALUES ('${requestId}','${userA}','key-1',repeat('a',64),1,'running','lease-1',
        now()+interval '2 minutes','${reservationId}','${priceId}',
        '71000000-0000-0000-0000-000000000001');`);
  });
  afterEach(async () => database.close());

  it("atomically persists strict history and ledger under tenant isolation", async () => {
    let ledgerSequence = 0;
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => `70000000-0000-0000-0000-${String(++ledgerSequence).padStart(12, "0")}`,
      priceVersionId: priceId,
    });
    const fixture = contractFixtures.analysis;
    const record = analysisRecordSchema.parse({
      ...fixture,
      id: analysisId,
      candidates: [{ ...fixture.candidates[0], id: candidateId }],
      result: {
        ...fixture.result,
        sentences: fixture.result.sentences.map((sentence) => ({
          ...sentence,
          candidateIds: [candidateId],
        })),
      },
    });
    await store.complete({
      actualCostMicroUsd: 20,
      billedCalls: [
        {
          costMicroUsd: 9,
          usage: { cachedInputTokens: 2, inputTokens: 4, outputTokens: 8 },
        },
        {
          costMicroUsd: 11,
          usage: { cachedInputTokens: 3, inputTokens: 6, outputTokens: 12 },
        },
      ],
      leaseToken: "lease-1",
      record,
      requestId,
      reservationId,
      userId: userA,
    });

    await expect(store.findById(userA, analysisId)).resolves.toEqual(record);
    await expect(store.findById(userB, analysisId)).resolves.toBeNull();
    const ledger = await database.query<{
      cached_input_tokens: number;
      call_ordinal: number;
      cost_micro_usd: string;
      input_tokens: number;
      outcome: string;
      output_tokens: number;
      price_version_id: string;
    }>(
      `SELECT cached_input_tokens, call_ordinal, cost_micro_usd::text, input_tokens, outcome,
       output_tokens, price_version_id::text FROM usage_ledger ORDER BY call_ordinal`,
    );
    expect(ledger.rows).toEqual([
      {
        cached_input_tokens: 2,
        call_ordinal: 0,
        cost_micro_usd: "9",
        input_tokens: 4,
        outcome: "succeeded",
        output_tokens: 8,
        price_version_id: priceId,
      },
      {
        cached_input_tokens: 3,
        call_ordinal: 1,
        cost_micro_usd: "11",
        input_tokens: 6,
        outcome: "succeeded",
        output_tokens: 12,
        price_version_id: priceId,
      },
    ]);
    const request = await database.query<{ state: string; terminal_event: unknown }>(
      `SELECT state,terminal_event FROM analysis_requests WHERE id='${requestId}'`,
    );
    expect(request.rows[0]?.state).toBe("completed");
    expect(request.rows[0]?.terminal_event).toMatchObject({ type: "analysis.completed" });
  });

  it("atomically settles a failed call and persists its strict terminal event", async () => {
    const failureRequestId = "40000000-0000-0000-0000-000000000002";
    const failureReservationId = "30000000-0000-0000-0000-000000000002";
    await database.exec(`UPDATE quota_reservations SET status='released' WHERE id='${reservationId}';
      INSERT INTO quota_reservations
      (id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at)
      VALUES ('${failureReservationId}','${userA}','${userA}','${failureRequestId}',
      date_trunc('month',now()),100,'active',now()+interval '5 minutes');
      INSERT INTO analysis_requests (id,owner_user_id,idempotency_key,request_hash,unit_count,
      state,lease_token,lease_expires_at,reservation_id,price_version_id,recovery_ledger_id)
      VALUES ('${failureRequestId}','${userA}','key-failure',repeat('b',64),1,'running','lease-failure',
      now()+interval '4 minutes','${failureReservationId}','${priceId}',
      '71000000-0000-0000-0000-000000000002');`);
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "72000000-0000-0000-0000-000000000001",
      priceVersionId: priceId,
    });
    await expect(
      store.fail({
        actualCostMicroUsd: 20,
        billedCalls: [
          {
            costMicroUsd: 20,
            usage: { cachedInputTokens: 5, inputTokens: 10, outputTokens: 20 },
          },
        ],
        error: {
          code: "model_unavailable",
          message: "Unavailable.",
          requestId: failureRequestId,
        },
        leaseToken: "wrong-lease",
        requestId: failureRequestId,
        reservationId: failureReservationId,
        userId: userA,
      }),
    ).rejects.toThrow(/analysis lease lost/iu);
    const rollback = await database.query<{ ledger_count: number; status: string }>(
      `SELECT (SELECT count(*)::integer FROM usage_ledger WHERE request_id='${failureRequestId}') ledger_count,
      (SELECT status FROM quota_reservations WHERE id='${failureReservationId}') status`,
    );
    expect(rollback.rows[0]).toEqual({ ledger_count: 0, status: "active" });

    const event = await store.fail({
      actualCostMicroUsd: 20,
      billedCalls: [
        {
          costMicroUsd: 20,
          usage: { cachedInputTokens: 5, inputTokens: 10, outputTokens: 20 },
        },
      ],
      error: {
        code: "model_output_invalid",
        message: "The model output was invalid.",
        requestId: failureRequestId,
      },
      leaseToken: "lease-failure",
      requestId: failureRequestId,
      reservationId: failureReservationId,
      userId: userA,
    });
    expect(event.type).toBe("analysis.failed");
    const state = await database.query<{
      ledger_count: number;
      request_state: string;
      status: string;
    }>(
      `SELECT (SELECT count(*)::integer FROM usage_ledger WHERE request_id='${failureRequestId}') ledger_count,
      (SELECT state FROM analysis_requests WHERE id='${failureRequestId}') request_state,
      (SELECT status FROM quota_reservations WHERE id='${failureReservationId}') status`,
    );
    expect(state.rows[0]).toEqual({ ledger_count: 1, request_state: "failed", status: "settled" });
  });

  it("atomically replays history mutations and preserves copied source examples on delete", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "73000000-0000-0000-0000-000000000001",
      priceVersionId: priceId,
    });
    const record = analysisRecordSchema.parse({
      ...contractFixtures.analysis,
      candidates: [{ ...contractFixtures.analysis.candidates[0], id: candidateId }],
      id: analysisId,
      result: {
        ...contractFixtures.analysis.result,
        sentences: contractFixtures.analysis.result.sentences.map((sentence) => ({
          ...sentence,
          candidateIds: [candidateId],
        })),
      },
    });
    await adapter.transaction(userA, async ({ tenant }) => {
      await tenant.rows(
        `INSERT INTO analysis_records(id,owner_user_id,review_state,source_type,source_text,
       source_normalized_hash,selection_kind,result,model_metadata,revision,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
        [
          record.id,
          userA,
          record.reviewState,
          record.source.type,
          record.sourceText,
          record.sourceNormalizedHash,
          record.selectionKind,
          JSON.stringify(record.result),
          JSON.stringify(record.modelMetadata),
          record.revision,
          record.createdAt,
          record.updatedAt,
        ],
      );
      const candidate = record.candidates[0];
      if (candidate === undefined) throw new Error("Missing fixture candidate.");
      await tenant.rows(
        `INSERT INTO analysis_candidates(id,analysis_id,owner_user_id,candidate_type,payload,
         analysis_unit_id,ordinal) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          candidateId,
          record.id,
          userA,
          candidate.type,
          JSON.stringify(candidate.payload),
          candidate.analysisUnitId,
          candidate.ordinal,
        ],
      );
    });
    const learningId = "74000000-0000-0000-0000-000000000001";
    const sourceId = "75000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${learningId}','${userA}','expression','kept',
      '{"type":"expression","text":"kept","meaningZh":"保留","usageZh":"用法"}');
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,analysis_id,source_text,source_type)
      VALUES('${sourceId}','${userA}','${learningId}','${analysisId}','Copied snapshot.','manual');`);
    const baseCommand = {
      id: analysisId,
      updatedAt: "2026-08-13T00:00:00.000Z",
      userId: userA,
    };
    await expect(
      store.processNothingToSave({
        ...baseCommand,
        expectedRevision: 1,
        idempotencyKey: "process-key",
        requestHash: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ reviewState: "reviewed", revision: 2 });
    await expect(
      store.archive({
        ...baseCommand,
        expectedRevision: 2,
        idempotencyKey: "archive-key",
        requestHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({
      archivedAt: "2026-08-13T00:00:00.000Z",
      revision: 3,
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
    await expect(
      store.restore({
        ...baseCommand,
        expectedRevision: 3,
        idempotencyKey: "restore-key",
        requestHash: "c".repeat(64),
      }),
    ).resolves.toMatchObject({ archivedAt: null, revision: 4 });
    const command = {
      ...baseCommand,
      expectedRevision: 4,
      idempotencyKey: "delete-key",
      requestHash: "d".repeat(64),
    };
    await expect(store.delete(command)).resolves.toEqual({ deleted: true, id: analysisId });
    await expect(store.delete(command)).resolves.toEqual({ deleted: true, id: analysisId });
    await expect(store.delete({ ...command, requestHash: "e".repeat(64) })).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
    const state = await database.query<{ analysis_id: string | null; source_text: string }>(
      `SELECT analysis_id::text,source_text FROM source_examples WHERE id='${sourceId}'`,
    );
    expect(state.rows).toEqual([{ analysis_id: null, source_text: "Copied snapshot." }]);
    expect(
      (await database.query(`SELECT 1 FROM learning_items WHERE id='${learningId}'`)).rows,
    ).toHaveLength(1);
  });

  it("does not let the business role invoke the private record serializer across tenants", async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.exec("SET LOCAL ROLE huayi_business");
        await transaction.query("SELECT huayi_private.analysis_public_record($1)", [analysisId]);
      }),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("filters literal query wildcards and keyset-paginates stable timestamp ties", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "76000000-0000-0000-0000-000000000001",
      priceVersionId: priceId,
    });
    const makeRecord = (suffix: "1" | "2", sourceText: string) => {
      const id = `81000000-0000-0000-0000-00000000000${suffix}`;
      const candidate = `82000000-0000-0000-0000-00000000000${suffix}`;
      return analysisRecordSchema.parse({
        ...contractFixtures.analysis,
        candidates: [{ ...contractFixtures.analysis.candidates[0], id: candidate }],
        id,
        result: {
          ...contractFixtures.analysis.result,
          sentences: contractFixtures.analysis.result.sentences.map((sentence) => ({
            ...sentence,
            candidateIds: [candidate],
          })),
        },
        sourceText,
      });
    };
    const exact = makeRecord("1", "Find 100% value_ now.");
    const wildcardLike = makeRecord("2", "Find 100x valueA now.");
    await store.save(userA, exact);
    await store.save(userA, wildcardLike);

    await expect(
      store.list(userA, { archived: false, limit: 20, query: "100% value_" }),
    ).resolves.toMatchObject({ items: [{ id: exact.id }] });
    const first = await store.list(userA, { archived: false, limit: 1 });
    expect(first).toMatchObject({ hasMore: true, items: [{ id: wildcardLike.id }] });
    await expect(
      store.list(userA, {
        archived: false,
        boundary: { createdAt: wildcardLike.createdAt, id: wildcardLike.id },
        limit: 1,
      }),
    ).resolves.toMatchObject({ hasMore: false, items: [{ id: exact.id }] });
    await expect(store.list(userB, { archived: false, limit: 20 })).resolves.toEqual({
      hasMore: false,
      items: [],
    });
  });
});
