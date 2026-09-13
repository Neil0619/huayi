import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { insertAccountDataExportAnalysisFixture } from "./test-support/account-data-export-analysis-fixture.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { structuredQueryFixture } from "./test-support/structured-query-fixture.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";

const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const id = "40000000-0000-0000-0000-000000000001";
let database: PGlite;
beforeEach(async () => {
  database = new PGlite();
  await database.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  for (const userId of [owner, other])
    await database.query(
      "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','UTC',5)",
      [userId, `${userId}@example.test`],
    );
});
afterEach(async () => database.close());

describe("structured account export source", () => {
  it.each(["analysis", "query"])(
    "reads the complete %s under owner authority before format projection",
    async (kind) => {
      const analysis = structuredAnalysisFixture();
      const query = structuredQueryFixture(id);
      if (kind === "analysis")
        await insertAccountDataExportAnalysisFixture(database, owner, analysis);
      else
        await database.query(
          // Keep creation and expiry on the same fixture timeline, independent of the test date.
          "INSERT INTO extension_query_generations(id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,terminal_event,expires_at,created_at,updated_at) VALUES($1,$2,'export',$3,'completed',$4::jsonb,'private-lease','2026-09-12T10:02:00Z',$5::jsonb,'2026-09-13T10:00:00Z','2026-09-12T10:00:00Z','2026-09-12T10:01:00Z')",
          [
            id,
            owner,
            "a".repeat(64),
            JSON.stringify({
              action: "explain",
              selectionKind: "sentence",
              sourceText: "We can.",
              sourceType: "web-selection",
              outputContract: "structured-teaching-v1",
            }),
            JSON.stringify({
              type: "query.completed",
              generationId: id,
              result: query,
              quota: new FakeAnalysisQuota().summary(),
            }),
          ],
        );
      const source = createPostgresAccountDataExportSource(createPgliteAnalysisDatabase(database));
      const records = await source.records(owner, "2026-09-12T11:00:00Z");
      expect(
        records.find(
          (record) =>
            record.recordType === (kind === "analysis" ? "analysis" : "extension-query-generation"),
        ),
      ).toMatchObject(
        kind === "analysis"
          ? { analysis }
          : { result: query, outputContract: "structured-teaching-v1" },
      );
      expect(
        (await source.records(other, "2026-09-12T11:00:00Z")).map((record) => record.recordType),
      ).toEqual(["account-preferences", "account-sign-in-methods"]);
      const serialized = JSON.stringify(records);
      for (const secret of [
        owner,
        other,
        "@example.test",
        "private-lease",
        "quota",
        "availableMicroUsd",
      ])
        expect(serialized).not.toContain(secret);
    },
  );
});
