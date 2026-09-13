import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisDatabase } from "./analysis-database.js";
import { createPostgresAnalysisStore } from "./postgres-analysis-store.js";
import { createPostgresAnalysisStoreFixture } from "./test-support/postgres-analysis-store-fixture.js";
import {
  structuredAnalysisAtCharacterLimit,
  structuredAnalysisFixture,
} from "./test-support/structured-analysis-fixture.js";

const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const analysisId = "10000000-0000-0000-0000-000000000001";
const reservationId = "30000000-0000-0000-0000-000000000001";
const requestId = "40000000-0000-0000-0000-000000000001";
const priceId = "50000000-0000-0000-0000-000000000001";

describe("Postgres structured analysis mutation budgets", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  beforeEach(async () => {
    ({ database, adapter } = await createPostgresAnalysisStoreFixture({
      userA,
      userB,
      reservationId,
      requestId,
      priceId,
    }));
  });
  afterEach(async () => database.close());
  it("rejects new records without mutable metadata reserve before inserting any row", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "unused",
      priceVersionId: priceId,
    });
    await expect(store.save(userA, structuredAnalysisAtCharacterLimit())).rejects.toThrow(
      /payload budget/u,
    );
    expect((await database.query("SELECT 1 FROM analysis_records")).rows).toEqual([]);
    expect((await database.query("SELECT 1 FROM analysis_candidates")).rows).toEqual([]);
  });

  it("rolls back a mutation and its replay if an existing record would exceed the reader budget", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "unused",
      priceVersionId: priceId,
    });
    await store.save(userA, structuredAnalysisFixture());
    const boundary = structuredAnalysisAtCharacterLimit();
    await database.query("UPDATE analysis_records SET result=$1::jsonb,revision=9 WHERE id=$2", [
      JSON.stringify(boundary.result),
      analysisId,
    ]);
    expect(await store.findById(userA, analysisId)).toEqual(boundary);
    await expect(
      store.archive({
        userId: userA,
        id: analysisId,
        expectedRevision: 9,
        idempotencyKey: "boundary-archive",
        requestHash: "b".repeat(64),
        updatedAt: "2026-09-12T11:00:00.000Z",
      }),
    ).rejects.toThrow(/payload budget/u);
    expect(await store.findById(userA, analysisId)).toEqual(boundary);
    expect(
      (await database.query("SELECT 1 FROM idempotency_records WHERE key='boundary-archive'")).rows,
    ).toEqual([]);
  });
});
