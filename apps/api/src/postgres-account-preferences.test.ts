import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAccountPreferences } from "./postgres-account-preferences.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres account preferences", () => {
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
        return operation(query(database));
      },
    };
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userA}','${userA}','a@example.test','active','UTC',3),
      ('${userB}','${userB}','b@example.test','active','Asia/Tokyo',7);`);
  });
  afterEach(async () => database.close());

  it("reads and updates only the tenant profile under forced RLS", async () => {
    const preferences = createPostgresAccountPreferences(adapter);
    await expect(preferences.read(userA)).resolves.toMatchObject({
      cloudWordCopyMode: "enabled",
      dailyGoal: 3,
      extensionQueryModelMode: "platform",
      revision: 1,
      studyCaptureMode: "manual",
      timezone: "UTC",
    });
    await expect(
      preferences.update(userA, {
        dailyGoal: 5,
        expectedRevision: 1,
        extensionQueryModelMode: "byok",
        timezone: "Asia/Shanghai",
      }),
    ).resolves.toMatchObject({
      dailyGoal: 5,
      extensionQueryModelMode: "byok",
      revision: 2,
      timezone: "Asia/Shanghai",
    });
    await expect(preferences.read(userB)).resolves.toMatchObject({
      cloudWordCopyMode: "enabled",
      dailyGoal: 7,
      extensionQueryModelMode: "platform",
      revision: 1,
      studyCaptureMode: "manual",
      timezone: "Asia/Tokyo",
    });
    await expect(
      preferences.update(userA, { dailyGoal: 8, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });
});
