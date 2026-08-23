import { readFile } from "node:fs/promises";

import { calculateModelCost } from "@huayi/cloud-contracts";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acceptanceProviderFetch,
  LOCAL_ACCEPTANCE_PROVIDER_KEY,
} from "./acceptance-provider-fetch.js";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";
import { DEEPSEEK_PLATFORM_MODEL } from "./deepseek-analysis-protocol.js";
import type { ApiEnvironment } from "./environment.js";
import { createProductionAnalysis } from "./production-analysis.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";
const legacyPriceId = "10000000-0000-0000-0000-000000000001";
const offPeakPriceId = "10000000-0000-0000-0000-000000000002";
const peakPriceId = "10000000-0000-0000-0000-000000000003";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("production analysis with the local acceptance provider", () => {
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
      INSERT INTO user_profiles (user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userId}','${userId}','acceptance@example.test','active','UTC',5);
      INSERT INTO model_price_versions (id,provider,model,input_micro_usd_per_million,
        cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
      VALUES
        ('${legacyPriceId}','deepseek','deepseek-v4-flash',140000,2800,280000,
          '2026-08-16T15:59:59Z'),
        ('${offPeakPriceId}','deepseek','deepseek-v4-flash',220000,7000,660000,
          '2026-08-16T16:00:00Z'),
        ('${peakPriceId}','deepseek','deepseek-v4-flash',440000,14000,1320000,
          '2026-08-16T16:00:01Z');
      INSERT INTO quota_grants (id,user_id,owner_user_id,period_start,period_end,
        limit_micro_usd,source)
      VALUES ('20000000-0000-0000-0000-000000000001','${userId}','${userId}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        1000000,'default');
      UPDATE runtime_controls SET enabled=false WHERE name='model_kill_switch';
    `);
  });

  afterEach(async () => database.close());

  it("persists and settles one passage through the complete production composition", async () => {
    const environment = {
      CRON_SECRET: "c".repeat(32),
      HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports-acceptance",
      HUAYI_API_ORIGIN: "https://api.acceptance.localhost:8444",
      HUAYI_DATABASE_URL: "postgresql://huayi_acceptance_login:acceptance@127.0.0.1:54322/postgres",
      HUAYI_DEEPSEEK_API_KEY: LOCAL_ACCEPTANCE_PROVIDER_KEY,
      HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: legacyPriceId,
      HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: offPeakPriceId,
      HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: peakPriceId,
      HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
      HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
      HUAYI_SECRET_PEPPER: "p".repeat(32),
      HUAYI_SECURITY_NOTIFICATION_MODE: "disabled-local-acceptance",
      HUAYI_STORE_EXTENSION_CAPABILITY: "enabled",
      HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
      HUAYI_WEB_ORIGIN: "https://app.acceptance.localhost:8443",
      SUPABASE_PUBLISHABLE_KEY: "publishable-local-acceptance",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-local-acceptance",
      SUPABASE_URL: "https://supabase.acceptance.localhost:8445",
    } satisfies ApiEnvironment;
    const pricing = createDeepSeekPriceSchedule({
      legacy: legacyPriceId,
      offPeak: offPeakPriceId,
      peak: peakPriceId,
    });
    const { analysis } = createProductionAnalysis({
      database: adapter,
      environment,
      fetch: acceptanceProviderFetch,
      pricing,
    });
    const sourceText =
      "The project team reviewed the draft carefully before sharing it with everyone.";
    const events = [];

    for await (const event of analysis.startPlatformAnalysis({
      idempotencyKey: "production-acceptance-passage",
      input: { selectionKind: "passage", source: { type: "manual" }, sourceText },
      userId,
    })) {
      events.push(event);
    }

    expect(events.at(-1)?.type).toBe("analysis.completed");
    const state = await database.query<{
      active_reservations: number;
      candidates: number;
      completed_requests: number;
      records: number;
      settled_reservations: number;
      usage_rows: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM analysis_records) records,
      (SELECT count(*)::integer FROM analysis_candidates) candidates,
      (SELECT count(*)::integer FROM usage_ledger) usage_rows,
      (SELECT count(*)::integer FROM analysis_requests WHERE state='completed') completed_requests,
      (SELECT count(*)::integer FROM quota_reservations WHERE status='settled') settled_reservations,
      (SELECT count(*)::integer FROM quota_reservations WHERE status='active') active_reservations`);
    expect(state.rows[0]).toEqual({
      active_reservations: 0,
      candidates: 1,
      completed_requests: 1,
      records: 1,
      settled_reservations: 1,
      usage_rows: 1,
    });

    const request = (
      await database.query<{
        dispatched_at: Date;
        id: string;
        price_version_id: string;
        reservation_id: string;
        state: string;
        terminal_type: string;
      }>(`SELECT id::text,state,dispatched_at,price_version_id::text,reservation_id::text,
        terminal_event->>'type' AS terminal_type FROM analysis_requests`)
    ).rows[0];
    if (request === undefined) throw new Error("Missing production analysis request.");
    expect(request).toMatchObject({ state: "completed", terminal_type: "analysis.completed" });
    expect(request.dispatched_at).toBeInstanceOf(Date);
    const dispatchPricing = pricing.at(request.dispatched_at);
    expect(request.price_version_id).toBe(dispatchPricing.priceVersionId);

    const reservation = (
      await database.query<{
        id: string;
        request_id: string;
        reserved_micro_usd: string;
        status: string;
      }>("SELECT id::text,request_id::text,reserved_micro_usd::text,status FROM quota_reservations")
    ).rows[0];
    if (reservation === undefined) throw new Error("Missing production quota reservation.");
    expect(reservation.request_id).toBe(request.id);
    expect(reservation.id).toBe(request.reservation_id);
    expect(reservation.status).toBe("settled");

    const ledger = (
      await database.query<{
        cached_input_tokens: number;
        call_ordinal: number;
        cost_micro_usd: string;
        feature: string;
        input_tokens: number;
        outcome: string;
        output_tokens: number;
        price_version_id: string;
        request_id: string;
      }>(`SELECT request_id::text,call_ordinal,feature,input_tokens,cached_input_tokens,
        output_tokens,price_version_id::text,cost_micro_usd::text,outcome FROM usage_ledger`)
    ).rows[0];
    if (ledger === undefined) throw new Error("Missing production usage ledger entry.");
    const expectedUsage = { cachedInputTokens: 0, inputTokens: 64, outputTokens: 32 };
    const expectedCost = calculateModelCost(expectedUsage, dispatchPricing.prices);
    expect(ledger).toEqual({
      cached_input_tokens: expectedUsage.cachedInputTokens,
      call_ordinal: 0,
      cost_micro_usd: String(expectedCost),
      feature: "analysis",
      input_tokens: expectedUsage.inputTokens,
      outcome: "succeeded",
      output_tokens: expectedUsage.outputTokens,
      price_version_id: request.price_version_id,
      request_id: request.id,
    });
    expect(Number(reservation.reserved_micro_usd)).toBeGreaterThanOrEqual(expectedCost);

    const record = (
      await database.query<{ model_metadata: unknown }>(
        "SELECT model_metadata FROM analysis_records",
      )
    ).rows[0];
    expect(record?.model_metadata).toMatchObject({
      inputTokens: expectedUsage.inputTokens,
      model: DEEPSEEK_PLATFORM_MODEL,
      outputTokens: expectedUsage.outputTokens,
      provider: "deepseek",
    });
  });
});
