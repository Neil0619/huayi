import { readFile } from "node:fs/promises";

import { analysisEventSchema, contractFixtures } from "@huayi/cloud-contracts";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisRequestLifecycle } from "./postgres-analysis-request-lifecycle.js";
import { createPostgresStudyCapture } from "./postgres-study-capture.js";
import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const requestId = "10000000-0000-0000-0000-000000000001";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres analysis request lifecycle", () => {
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
          const base = query(transaction);
          return operation({
            tenant: {
              async rows<Row>(text: string, parameters: readonly unknown[] = []) {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return base.rows<Row>(text, parameters);
              },
            },
            trusted: base,
          });
        });
      },
      async trusted(operation) {
        return database.transaction((transaction) => operation(query(transaction)));
      },
    };
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','active','UTC',5);`);
  });
  afterEach(async () => database.close());

  it("persists one cross-instance claim and isolates status by tenant", async () => {
    const first = createPostgresAnalysisRequestLifecycle(adapter);
    const second = createPostgresAnalysisRequestLifecycle(adapter);
    const command = {
      idempotencyKey: "shared-key",
      leaseExpiresAt: new Date(Date.now() + 240_000),
      leaseToken: "lease-a",
      recoveryLedgerId: "20000000-0000-0000-0000-000000000001",
      requestHash: "a".repeat(64),
      requestId,
      unitCount: 1,
      userId: userA,
    };
    await expect(first.begin(command)).resolves.toMatchObject({ kind: "acquired", requestId });
    await expect(
      second.begin({
        ...command,
        leaseToken: "lease-b",
        requestId: "10000000-0000-0000-0000-000000000002",
      }),
    ).resolves.toEqual({ kind: "running", requestId, unitCount: 1 });
    await expect(first.get(userA, requestId)).resolves.toEqual({ requestId, state: "running" });
    await expect(first.get(userB, requestId)).resolves.toBeNull();
    await expect(
      second.begin({
        ...command,
        requestHash: "b".repeat(64),
        requestId: "10000000-0000-0000-0000-000000000003",
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("atomically validates and pins the dispatch-time price snapshot before provider work", async () => {
    const lifecycle = createPostgresAnalysisRequestLifecycle(adapter);
    const schedule = createDeepSeekPriceSchedule({
      legacy: "31000000-0000-4000-8000-000000000001",
      offPeak: "31000000-0000-4000-8000-000000000002",
      peak: "31000000-0000-4000-8000-000000000003",
    });
    const dispatchedAt = new Date("2026-08-17T04:00:00.000Z");
    const pricing = schedule.at(dispatchedAt);
    const reservationId = "41000000-0000-4000-8000-000000000001";
    await lifecycle.begin({
      idempotencyKey: "dispatch-price",
      leaseExpiresAt: new Date(Date.now() + 240_000),
      leaseToken: "dispatch-lease",
      recoveryLedgerId: "61000000-0000-4000-8000-000000000001",
      requestHash: "9".repeat(64),
      requestId,
      unitCount: 1,
      userId: userA,
    });
    await database.exec(`INSERT INTO model_price_versions(id,provider,model,
      input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from)
      VALUES('${pricing.priceVersionId}','deepseek','deepseek-v4-flash',
      ${pricing.prices.inputMicroUsdPerMillionTokens},
      ${pricing.prices.cachedInputMicroUsdPerMillionTokens},
      ${pricing.prices.outputMicroUsdPerMillionTokens},'2026-08-16T16:00:00Z');
      INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
      VALUES('51000000-0000-4000-8000-000000000001','${userA}','${userA}',
      '2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',1000000,'default');
      INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,
      reserved_micro_usd,status,expires_at)
      VALUES('${reservationId}','${userA}','${userA}','${requestId}','2026-08-01T00:00:00Z',
      1000,'active','2026-08-17T04:05:00Z');`);
    await lifecycle.attachReservation({
      leaseToken: "dispatch-lease",
      requestId,
      reservationId,
      userId: userA,
    });

    await lifecycle.markDispatched?.({
      dispatchedAt,
      leaseToken: "dispatch-lease",
      pricing,
      requestId,
      userId: userA,
    });

    const rows = await database.query<{ dispatched_at: Date; price_version_id: string }>(
      "SELECT dispatched_at,price_version_id::text FROM analysis_requests WHERE id=$1",
      [requestId],
    );
    expect(rows.rows[0]).toMatchObject({ price_version_id: pricing.priceVersionId });
    expect(rows.rows[0]?.dispatched_at.toISOString()).toBe(dispatchedAt.toISOString());
  });

  it("durably terminalizes an expired reservation and rejects the stale lease", async () => {
    const priceId = "30000000-0000-0000-0000-000000000001";
    const reservationId = "40000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO model_price_versions(id,provider,model,
      input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from)
      VALUES ('${priceId}','deepseek','fixed',1,1,1,now());
      INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
      VALUES ('50000000-0000-0000-0000-000000000001','${userA}','${userA}',date_trunc('month',now()),
      date_trunc('month',now())+interval '1 month',1000,'default');
      INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,
      reserved_micro_usd,status,expires_at)
      VALUES ('${reservationId}','${userA}','${userA}','${requestId}',date_trunc('month',now()),
      100,'active',now()+interval '5 minutes');
      INSERT INTO analysis_requests(id,owner_user_id,idempotency_key,request_hash,unit_count,
      state,lease_token,lease_expires_at,reservation_id,price_version_id,dispatched_at,recovery_ledger_id)
      VALUES ('${requestId}','${userA}','expired','${"a".repeat(64)}',1,'running','stale',
      now()-interval '1 second','${reservationId}','${priceId}',now()-interval '2 minutes',
      '60000000-0000-0000-0000-000000000001');`);
    const lifecycle = createPostgresAnalysisRequestLifecycle(adapter);
    const claim = await lifecycle.begin({
      idempotencyKey: "expired",
      leaseExpiresAt: new Date(Date.now() + 240_000),
      leaseToken: "new",
      recoveryLedgerId: "70000000-0000-0000-0000-000000000001",
      requestHash: "a".repeat(64),
      requestId: "10000000-0000-0000-0000-000000000002",
      unitCount: 1,
      userId: userA,
    });
    expect(claim.kind).toBe("terminal");
    if (claim.kind === "terminal")
      expect(analysisEventSchema.parse(claim.event).type).toBe("analysis.failed");
    const rows = await database.query<{
      ledger_count: number;
      request_state: string;
      reservation_status: string;
    }>(
      `SELECT (SELECT count(*)::integer FROM usage_ledger) ledger_count,
       (SELECT state FROM analysis_requests WHERE id='${requestId}') request_state,
       (SELECT status FROM quota_reservations WHERE id='${reservationId}') reservation_status`,
    );
    expect(rows.rows[0]).toEqual({
      ledger_count: 1,
      request_state: "failed",
      reservation_status: "settled",
    });
    await expect(
      database.query("SELECT finish_analysis_request($1,$2,$3,$4::jsonb)", [
        userA,
        requestId,
        "stale",
        JSON.stringify(claim.kind === "terminal" ? claim.event : {}),
      ]),
    ).rejects.toThrow(/analysis lease lost/iu);
    await expect(
      lifecycle.begin({
        idempotencyKey: "expired",
        leaseExpiresAt: new Date(Date.now() + 240_000),
        leaseToken: "another",
        recoveryLedgerId: "80000000-0000-0000-0000-000000000001",
        requestHash: "a".repeat(64),
        requestId: "10000000-0000-0000-0000-000000000003",
        unitCount: 1,
        userId: userA,
      }),
    ).resolves.toMatchObject({ kind: "terminal", requestId });
  });

  it("conservatively accounts for an abandoned reservation already released by cleanup", async () => {
    const releasedRequestId = "10000000-0000-0000-0000-000000000004";
    const priceId = "30000000-0000-0000-0000-000000000004";
    const reservationId = "40000000-0000-0000-0000-000000000004";
    await database.exec(`INSERT INTO model_price_versions(id,provider,model,
      input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from)
      VALUES ('${priceId}','deepseek','fixed-released',1,1,1,now());
      INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
      VALUES ('50000000-0000-0000-0000-000000000004','${userA}','${userA}',date_trunc('month',now()),
      date_trunc('month',now())+interval '1 month',1000,'default');
      INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,
      reserved_micro_usd,status,expires_at)
      VALUES ('${reservationId}','${userA}','${userA}','${releasedRequestId}',date_trunc('month',now()),
      100,'released',now()-interval '1 minute');
      INSERT INTO analysis_requests(id,owner_user_id,idempotency_key,request_hash,unit_count,
      state,lease_token,lease_expires_at,reservation_id,price_version_id,dispatched_at,recovery_ledger_id)
      VALUES ('${releasedRequestId}','${userA}','released','${"c".repeat(64)}',1,'running','stale-released',
      now()-interval '2 minutes','${reservationId}','${priceId}',now()-interval '3 minutes',
      '60000000-0000-0000-0000-000000000004');`);
    const lifecycle = createPostgresAnalysisRequestLifecycle(adapter);
    await expect(
      lifecycle.begin({
        idempotencyKey: "released",
        leaseExpiresAt: new Date(Date.now() + 240_000),
        leaseToken: "new-released",
        recoveryLedgerId: "70000000-0000-0000-0000-000000000004",
        requestHash: "c".repeat(64),
        requestId: "10000000-0000-0000-0000-000000000005",
        unitCount: 1,
        userId: userA,
      }),
    ).resolves.toMatchObject({ kind: "terminal", requestId: releasedRequestId });
    const result = await database.query<{
      ledger_count: number;
      request_state: string;
      reservation_status: string;
    }>(`SELECT (SELECT count(*)::integer FROM usage_ledger
        WHERE request_id='${releasedRequestId}') ledger_count,
      (SELECT state FROM analysis_requests WHERE id='${releasedRequestId}') request_state,
      (SELECT status FROM quota_reservations WHERE id='${reservationId}') reservation_status`);
    expect(result.rows[0]).toEqual({
      ledger_count: 1,
      request_state: "failed",
      reservation_status: "settled",
    });
  });

  it("atomically owns capture state and restores an initial failure", async () => {
    const captureId = "90000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO study_captures(id,owner_user_id,selection_kind,source_text,
      normalized_text_hash,status,first_captured_at,last_captured_at,revision)
      VALUES('${captureId}','${userA}','sentence','A useful line.','${"d".repeat(64)}','pending',
      now(),now(),1);`);
    const lifecycle = createPostgresAnalysisRequestLifecycle(adapter);
    const claim = await lifecycle.beginCapture({
      captureId,
      expectedRevision: 1,
      idempotencyKey: "capture-analysis",
      intent: "initial",
      leaseExpiresAt: new Date(Date.now() + 240_000),
      leaseToken: "capture-lease",
      recoveryLedgerId: "90000000-0000-0000-0000-000000000002",
      requestHash: "e".repeat(64),
      requestId: "90000000-0000-0000-0000-000000000003",
      unitCount: 1,
      userId: userA,
    });
    expect(claim).toMatchObject({ kind: "acquired" });
    await expect(createPostgresStudyCapture(adapter).find(userA, captureId)).resolves.toMatchObject(
      {
        activeAnalysisRequest: {
          requestId: "90000000-0000-0000-0000-000000000003",
          state: "running",
        },
        capture: { revision: 2, status: "analyzing" },
      },
    );
    await expect(
      lifecycle.beginCapture({
        captureId,
        expectedRevision: 2,
        idempotencyKey: "another-key",
        intent: "initial",
        leaseExpiresAt: new Date(Date.now() + 240_000),
        leaseToken: "another-lease",
        recoveryLedgerId: "90000000-0000-0000-0000-000000000004",
        requestHash: "f".repeat(64),
        requestId: "90000000-0000-0000-0000-000000000005",
        unitCount: 1,
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "generation_busy" });
    await lifecycle.terminalizeWithoutReservation({
      error: {
        code: "model_unavailable",
        message: "The model is temporarily unavailable.",
        requestId: "90000000-0000-0000-0000-000000000003",
      },
      leaseToken: "capture-lease",
      quota: contractFixtures.quota,
      requestId: "90000000-0000-0000-0000-000000000003",
      userId: userA,
    });
    const state = await database.query<{ revision: number; status: string }>(
      `SELECT revision,status FROM study_captures WHERE id='${captureId}'`,
    );
    expect(state.rows).toEqual([{ revision: 3, status: "pending" }]);

    await lifecycle.beginCapture({
      captureId,
      expectedRevision: 3,
      idempotencyKey: "capture-success",
      intent: "initial",
      leaseExpiresAt: new Date(Date.now() + 240_000),
      leaseToken: "success-lease",
      recoveryLedgerId: "90000000-0000-0000-0000-000000000006",
      requestHash: "1".repeat(64),
      requestId: "90000000-0000-0000-0000-000000000007",
      unitCount: 1,
      userId: userA,
    });
    await database.query("SELECT finish_analysis_request($1,$2,$3,$4::jsonb)", [
      userA,
      "90000000-0000-0000-0000-000000000007",
      "success-lease",
      JSON.stringify(contractFixtures.completedEvent),
    ]);
    await expect(
      database.query<{ revision: number; status: string }>(
        `SELECT revision,status FROM study_captures WHERE id='${captureId}'`,
      ),
    ).resolves.toMatchObject({ rows: [{ revision: 5, status: "analyzed" }] });

    await lifecycle.beginCapture({
      captureId,
      expectedRevision: 5,
      idempotencyKey: "capture-reanalysis",
      intent: "reanalysis",
      leaseExpiresAt: new Date(Date.now() + 240_000),
      leaseToken: "reanalysis-lease",
      recoveryLedgerId: "90000000-0000-0000-0000-000000000008",
      requestHash: "2".repeat(64),
      requestId: "90000000-0000-0000-0000-000000000009",
      unitCount: 1,
      userId: userA,
    });
    await lifecycle.terminalizeWithoutReservation({
      error: {
        code: "model_unavailable",
        message: "The model is temporarily unavailable.",
        requestId: "90000000-0000-0000-0000-000000000009",
      },
      leaseToken: "reanalysis-lease",
      quota: contractFixtures.quota,
      requestId: "90000000-0000-0000-0000-000000000009",
      userId: userA,
    });
    await expect(
      database.query<{ revision: number; status: string }>(
        `SELECT revision,status FROM study_captures WHERE id='${captureId}'`,
      ),
    ).resolves.toMatchObject({ rows: [{ revision: 7, status: "analyzed" }] });
  });
});
