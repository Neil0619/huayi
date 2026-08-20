import { describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};

function databaseWith(rows: AnalysisQuery["rows"]): AnalysisDatabase {
  return {
    async transaction() {
      throw new Error("not used");
    },
    async trusted(operation) {
      return operation({ rows });
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
