import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAccountSignInMethods } from "./postgres-account-sign-in-methods.js";

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

describe("Postgres account sign-in methods", () => {
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
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userA}','${userA}','a@example.test','active','UTC',3),
        ('${userB}','${userB}','b@example.test','active','UTC',3);
      INSERT INTO account_sign_in_methods(owner_user_id,method,linked_at)
      VALUES('${userA}','google','2026-08-14T01:00:00Z'),
        ('${userA}','password','2026-08-14T00:00:00Z'),
        ('${userB}','google','2026-08-14T02:00:00Z');
    `);
  });
  afterEach(async () => database.close());

  it("returns only the owner methods in canonical order under forced RLS", async () => {
    const repository = createPostgresAccountSignInMethods(adapter);
    await expect(repository.read(userA)).resolves.toEqual([
      { linkedAt: new Date("2026-08-14T00:00:00.000Z"), method: "password" },
      { linkedAt: new Date("2026-08-14T01:00:00.000Z"), method: "google" },
    ]);
    await expect(repository.read(userB)).resolves.toEqual([
      { linkedAt: new Date("2026-08-14T02:00:00.000Z"), method: "google" },
    ]);
  });
});
