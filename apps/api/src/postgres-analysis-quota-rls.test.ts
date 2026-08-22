import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres analysis quota forced-RLS summary", () => {
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
            trusted: query(transaction),
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
      VALUES('${userId}','${userId}','learner@example.test','active','UTC',5);
    `);
  });

  afterEach(async () => database.close());

  it("ensures then reads the current owner quota through the forced-RLS business role", async () => {
    const quota = createPostgresAnalysisQuota({
      database: adapter,
      expiresAt: () => new Date(Date.now() + 60_000),
      id: () => "10000000-0000-4000-8000-000000000002",
      now: () => new Date(),
      priceVersionId: "10000000-0000-4000-8000-000000000003",
    });

    await expect(quota.summary(userId)).resolves.toMatchObject({
      availableMicroUsd: 1_000_000,
      limitMicroUsd: 1_000_000,
      reservedMicroUsd: 0,
      usedMicroUsd: 0,
      warning: "available",
    });
    const grants = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM quota_grants
      WHERE user_id='${userId}' AND source='default' AND limit_micro_usd=1000000
        AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND superseded_at IS NULL
    `);
    expect(grants.rows).toEqual([{ count: 1 }]);
  });
});
