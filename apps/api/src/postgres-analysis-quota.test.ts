import { describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};

function databaseWith(rows: AnalysisQuery["rows"]): AnalysisDatabase {
  const query = { rows };
  return {
    async transaction(_ownerUserId, operation) {
      return operation({ tenant: query, trusted: query });
    },
    async trusted(operation) {
      return operation(query);
    },
  };
}

describe("Postgres analysis quota", () => {
  it("requires the configured immutable price snapshot before reserving", async () => {
    const calls: { parameters: readonly unknown[]; sql: string }[] = [];
    const rows: AnalysisQuery["rows"] = async <Row>(sql: string, parameters = []) => {
      calls.push({ parameters, sql });
      return (sql.includes("reserve_quota") ? [{ id: "reservation-1" }] : [{ ok: true }]) as Row[];
    };
    const quota = createPostgresAnalysisQuota({
      database: databaseWith(rows),
      expiresAt: () => new Date("2026-08-12T10:02:00.000Z"),
      id: () => "reservation-1",
      now: () => new Date("2026-08-12T10:00:00.000Z"),
      prices,
      priceVersionId: "10000000-0000-4000-8000-000000000001",
      providerModel: "deepseek-v4-flash",
    });

    await expect(
      quota.reserve({ requestId: "request-1", reservedMicroUsd: 100, userId: "user-1" }),
    ).resolves.toEqual({ id: "reservation-1" });
    expect(calls[0]?.parameters).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "deepseek-v4-flash",
      1_000_000,
      500_000,
      2_000_000,
    ]);
  });

  it("fails closed when deployment prices do not match the referenced row", async () => {
    const quota = createPostgresAnalysisQuota({
      database: databaseWith(async () => {
        throw new Error("model price mismatch");
      }),
      expiresAt: () => new Date("2026-08-12T10:02:00.000Z"),
      id: () => "reservation-1",
      now: () => new Date("2026-08-12T10:00:00.000Z"),
      prices,
      priceVersionId: "10000000-0000-4000-8000-000000000001",
      providerModel: "deepseek-v4-flash",
    });

    await expect(
      quota.reserve({ requestId: "request-1", reservedMicroUsd: 100, userId: "user-1" }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("maps the persistent model limiter separately from quota exhaustion", async () => {
    const quota = createPostgresAnalysisQuota({
      database: databaseWith(async () => {
        throw new Error("model rate limited");
      }),
      expiresAt: () => new Date("2026-08-12T10:02:00.000Z"),
      id: () => "reservation-1",
      now: () => new Date("2026-08-12T10:00:00.000Z"),
      priceVersionId: "10000000-0000-4000-8000-000000000001",
    });

    await expect(
      quota.reserve({ requestId: "request-1", reservedMicroUsd: 100, userId: "user-1" }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("ensures and reads only the current UTC month through the owner transaction", async () => {
    const calls: { parameters: readonly unknown[]; sql: string }[] = [];
    const database: AnalysisDatabase = {
      async transaction(_ownerUserId, operation) {
        const rows: AnalysisQuery["rows"] = async <Row>(sql: string, parameters = []) => {
          calls.push({ parameters, sql });
          if (sql.includes("ensure_owner_current_default_quota")) return [];
          return [
            {
              limit_micro_usd: "1000000",
              period_end: new Date("2026-09-01T00:00:00.000Z"),
              period_start: new Date("2026-08-01T00:00:00.000Z"),
              reserved_micro_usd: "0",
              used_micro_usd: "0",
            },
          ] as Row[];
        };
        const query = { rows };
        return operation({ tenant: query, trusted: query });
      },
      async trusted(operation) {
        return operation({ rows: async () => [] });
      },
    };
    const quota = createPostgresAnalysisQuota({
      database,
      expiresAt: () => new Date("2026-08-12T10:02:00.000Z"),
      id: () => "reservation-1",
      now: () => new Date("2026-08-12T10:00:00.000Z"),
      priceVersionId: "10000000-0000-4000-8000-000000000001",
    });

    await expect(quota.summary("user-1")).resolves.toMatchObject({ limitMicroUsd: 1_000_000 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      parameters: ["user-1", new Date("2026-08-12T10:00:00.000Z")],
    });
    expect(calls[0]?.sql).toContain("ensure_owner_current_default_quota");
    expect(calls[1]?.parameters).toEqual(["user-1", new Date("2026-08-01T00:00:00.000Z")]);
  });

  it("returns a strict exhausted summary when no grant exists", async () => {
    const quota = createPostgresAnalysisQuota({
      database: databaseWith(async () => []),
      expiresAt: () => new Date("2026-08-12T10:05:00.000Z"),
      id: () => "reservation-1",
      now: () => new Date("2026-08-12T10:00:00.000Z"),
      priceVersionId: "10000000-0000-4000-8000-000000000001",
    });

    await expect(quota.summary("user-1")).resolves.toEqual({
      availableMicroUsd: 0,
      limitMicroUsd: 0,
      percentUsed: 100,
      periodEnd: "2026-09-01T00:00:00.000Z",
      periodStart: "2026-08-01T00:00:00.000Z",
      reservedMicroUsd: 0,
      usedMicroUsd: 0,
      warning: "exhausted",
    });
  });
});
