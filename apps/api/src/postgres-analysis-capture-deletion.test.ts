import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisStore } from "./postgres-analysis-store.js";

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

describe("Postgres analysis capture deletion", () => {
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
          return operation({ tenant, trusted });
        });
      },
      async trusted(operation) {
        return database.transaction((transaction) => operation(query(transaction)));
      },
    };
    await database.exec(`INSERT INTO user_profiles
      (user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userId}','${userId}','a@example.test','active','UTC',5);`);
  });

  afterEach(async () => database.close());

  it("deletes the current capture relationship only when explicitly confirmed", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "73000000-0000-0000-0000-000000000009",
      priceVersionId: "50000000-0000-0000-0000-000000000001",
    });
    const retainedCapture = "81000000-0000-0000-0000-000000000001";
    const deletedCapture = "81000000-0000-0000-0000-000000000002";
    const retainedAnalysis = "82000000-0000-0000-0000-000000000001";
    const olderAnalysis = "82000000-0000-0000-0000-000000000002";
    const latestAnalysis = "82000000-0000-0000-0000-000000000003";
    await database.exec(`INSERT INTO study_captures(id,owner_user_id,selection_kind,source_text,
      normalized_text_hash,status,first_captured_at,last_captured_at)
      VALUES('${retainedCapture}','${userId}','sentence','Retain capture.','${"1".repeat(64)}',
      'analyzed',now(),now()),('${deletedCapture}','${userId}','sentence','Delete capture.',
      '${"2".repeat(64)}','analyzed',now(),now());
      INSERT INTO analysis_records(id,owner_user_id,study_capture_id,review_state,source_type,
      source_text,source_normalized_hash,selection_kind,result,model_metadata,revision,created_at,updated_at)
      VALUES('${retainedAnalysis}','${userId}','${retainedCapture}','pendingReview','study-capture',
      'Retain capture.','${"1".repeat(64)}','sentence','{}','{}',1,'2026-08-13T00:00:00Z',now()),
      ('${olderAnalysis}','${userId}','${deletedCapture}','pendingReview','study-capture',
      'Delete capture.','${"2".repeat(64)}','sentence','{}','{}',1,'2026-08-13T00:00:00Z',now()),
      ('${latestAnalysis}','${userId}','${deletedCapture}','pendingReview','study-capture',
      'Delete capture.','${"2".repeat(64)}','sentence','{}','{}',1,'2026-08-13T01:00:00Z',now());`);
    const command = (id: string, key: string, deleteStudyCapture: boolean) => ({
      deleteStudyCapture,
      expectedRevision: 1,
      id,
      idempotencyKey: key,
      requestHash: "a".repeat(64),
      updatedAt: "2026-08-13T02:00:00.000Z",
      userId,
    });

    await store.delete(command(retainedAnalysis, "retain", false));
    await expect(
      database.query<{ status: string }>(
        `SELECT status FROM study_captures WHERE id='${retainedCapture}'`,
      ),
    ).resolves.toMatchObject({ rows: [{ status: "pending" }] });
    await expect(store.delete(command(olderAnalysis, "old-delete", true))).rejects.toMatchObject({
      code: "study_capture_in_use",
    });
    const latestCommand = command(latestAnalysis, "latest-delete", true);
    await expect(store.delete(latestCommand)).resolves.toEqual({
      deleted: true,
      id: latestAnalysis,
    });
    await expect(store.delete(latestCommand)).resolves.toEqual({
      deleted: true,
      id: latestAnalysis,
    });
    expect(
      (await database.query(`SELECT 1 FROM study_captures WHERE id='${deletedCapture}'`)).rows,
    ).toHaveLength(0);
    await expect(
      database.query<{ study_capture_id: string | null }>(
        `SELECT study_capture_id::text FROM analysis_records WHERE id='${olderAnalysis}'`,
      ),
    ).resolves.toMatchObject({ rows: [{ study_capture_id: null }] });
  });
});
