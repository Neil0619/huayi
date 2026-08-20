import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresStudyCapture } from "./postgres-study-capture.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres StudyCapture authority", () => {
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
    await database.exec(`INSERT INTO user_profiles(
      user_id,owner_user_id,email,status,timezone,daily_goal
    ) VALUES('${userA}','${userA}','a@example.test','active','UTC',5);`);
  });
  afterEach(async () => database.close());

  it("creates once, replays one key, and advances a real exact occurrence", async () => {
    const ids = ["50000000-0000-0000-0000-00000000000a", "50000000-0000-0000-0000-00000000000b"];
    const repository = createPostgresStudyCapture(adapter, {
      id: () => ids.shift() ?? "50000000-0000-0000-0000-00000000000c",
    });
    const command = {
      idempotencyKey: "capture-1",
      normalizedSourceText: "You're ready",
      normalizedTextHash: "a".repeat(64),
      now: "2026-08-13T00:00:00.000Z",
      ownerUserId: userA,
      request: { kind: "sentence" as const, sourceText: "You’re   ready" },
      requestHash: "b".repeat(64),
    };
    const created = await repository.create(command);
    expect(created).toMatchObject({
      capture: { captureCount: 1, revision: 1, sourceText: "You’re   ready" },
      outcome: "created",
      undo: { expectedRevision: 1 },
    });
    await expect(repository.create(command)).resolves.toEqual(created);
    await expect(
      repository.create({
        ...command,
        idempotencyKey: "capture-2",
        now: "2026-08-13T00:01:00.000Z",
        request: { kind: "sentence", sourceText: "You're ready" },
        requestHash: "c".repeat(64),
      }),
    ).resolves.toMatchObject({ capture: { captureCount: 2, revision: 2 }, outcome: "existing" });
  });

  it("allows one unchanged pending current-card undo and replays after deletion", async () => {
    const repository = createPostgresStudyCapture(adapter, {
      id: () => "50000000-0000-0000-0000-00000000000a",
    });
    await repository.create({
      idempotencyKey: "capture-1",
      normalizedSourceText: "One line",
      normalizedTextHash: "a".repeat(64),
      now: "2026-08-13T00:00:00.000Z",
      ownerUserId: userA,
      request: { kind: "sentence", sourceText: "One line" },
      requestHash: "b".repeat(64),
    });
    const undo = {
      captureId: "50000000-0000-0000-0000-00000000000a",
      expectedRevision: 1,
      idempotencyKey: "undo-1",
      now: "2026-08-13T00:00:30.000Z",
      ownerUserId: userA,
      requestHash: "e".repeat(64),
    };
    await expect(repository.delete(undo)).resolves.toEqual({ deleted: true, id: undo.captureId });
    await expect(repository.delete(undo)).resolves.toEqual({ deleted: true, id: undo.captureId });
  });

  it("fails closed on a normalized hash collision and idempotency conflict", async () => {
    const repository = createPostgresStudyCapture(adapter, {
      id: () => "50000000-0000-0000-0000-00000000000a",
    });
    const command = {
      idempotencyKey: "capture-1",
      normalizedSourceText: "First line",
      normalizedTextHash: "a".repeat(64),
      now: "2026-08-13T00:00:00.000Z",
      ownerUserId: userA,
      request: { kind: "sentence" as const, sourceText: "First line" },
      requestHash: "b".repeat(64),
    };
    await repository.create(command);
    await expect(
      repository.create({ ...command, requestHash: "c".repeat(64) }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(
      repository.create({
        ...command,
        idempotencyKey: "capture-2",
        normalizedSourceText: "Different line",
        request: { kind: "sentence", sourceText: "Different line" },
        requestHash: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "capture_hash_collision" });
  });

  it("lists literal server filters and patches pending metadata with revision replay", async () => {
    const repository = createPostgresStudyCapture(adapter, {
      id: () => "50000000-0000-0000-0000-00000000000a",
    });
    await repository.create({
      idempotencyKey: "capture-1",
      normalizedSourceText: "One line",
      normalizedTextHash: "a".repeat(64),
      now: "2026-08-13T00:00:00.000Z",
      ownerUserId: userA,
      request: { kind: "sentence", sourceText: "One line" },
      requestHash: "b".repeat(64),
    });
    const command = {
      captureId: "50000000-0000-0000-0000-00000000000a",
      idempotencyKey: "patch-1",
      input: {
        expectedRevision: 1,
        kind: "passage" as const,
        title: "A 100% useful line",
        userContext: "Keep the tone",
      },
      now: "2026-08-13T00:01:00.000Z",
      ownerUserId: userA,
      requestHash: "c".repeat(64),
    };
    const updated = await repository.patch(command);
    expect(updated).toMatchObject({
      capture: { kind: "passage", revision: 2, title: "A 100% useful line" },
      latestAnalysis: null,
    });
    await expect(repository.patch(command)).resolves.toEqual(updated);
    await expect(
      repository.list(userA, { limit: 20, query: "%", status: "pending" }),
    ).resolves.toMatchObject({
      hasMore: false,
      items: [{ capture: { id: command.captureId } }],
    });
    await expect(repository.find(userA, command.captureId)).resolves.toEqual(updated);
  });

  it("links a new exact capture to only the latest unchanged manual analysis", async () => {
    const older = "60000000-0000-0000-0000-000000000001";
    const latest = "60000000-0000-0000-0000-000000000002";
    await database.exec(`INSERT INTO analysis_records(id,owner_user_id,review_state,source_type,
      source_text,source_normalized_hash,selection_kind,result,model_metadata,revision,created_at,updated_at)
      VALUES('${older}','${userA}','pendingReview','manual','This is worth learning.','${"a".repeat(64)}',
      'sentence','{}','{}',1,'2026-08-12T00:00:00Z','2026-08-12T00:00:00Z'),
      ('${latest}','${userA}','pendingReview','manual','This is worth learning.','${"a".repeat(64)}',
      'sentence','{}','{}',1,'2026-08-13T00:00:00Z','2026-08-13T00:00:00Z');`);
    const repository = createPostgresStudyCapture(adapter, {
      id: () => "50000000-0000-0000-0000-00000000000a",
    });
    await expect(
      repository.create({
        idempotencyKey: "capture-linked",
        normalizedSourceText: "This is worth learning.",
        normalizedTextHash: "a".repeat(64),
        now: "2026-08-13T01:00:00.000Z",
        ownerUserId: userA,
        request: { kind: "sentence", sourceText: "This is worth learning." },
        requestHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({
      capture: { revision: 1, status: "analyzed" },
      outcome: "linked-analysis",
    });
    const links = await database.query<{
      id: string;
      source_type: string;
      study_capture_id: string | null;
    }>(
      `SELECT id::text,source_type,study_capture_id::text FROM analysis_records ORDER BY created_at`,
    );
    expect(links.rows).toEqual([
      { id: older, source_type: "manual", study_capture_id: null },
      {
        id: latest,
        source_type: "manual",
        study_capture_id: "50000000-0000-0000-0000-00000000000a",
      },
    ]);
  });
});
