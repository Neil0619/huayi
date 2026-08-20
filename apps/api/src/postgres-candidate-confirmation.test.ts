import { readFile } from "node:fs/promises";

import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import type { ConfirmCandidatesCommand } from "./analysis-ports.js";
import { createPostgresAnalysisStore } from "./postgres-analysis-store.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const analysisId = "10000000-0000-0000-0000-000000000001";
const candidateId = "20000000-0000-0000-0000-000000000001";
const wordCandidateId = "20000000-0000-0000-0000-000000000002";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres candidate confirmation", () => {
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
        return database.transaction((transaction) => operation(query(transaction)));
      },
    };
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','active','UTC',5);`);
    const record = analysisRecordSchema.parse({
      ...contractFixtures.analysis,
      candidates: [{ ...contractFixtures.analysis.candidates[0], id: candidateId }],
      id: analysisId,
      result: {
        ...contractFixtures.analysis.result,
        sentences: contractFixtures.analysis.result.sentences.map((sentence) => ({
          ...sentence,
          candidateIds: [candidateId],
        })),
      },
    });
    await database.query(
      `INSERT INTO analysis_records(id,owner_user_id,review_state,source_type,
      source_title,source_text,source_normalized_hash,selection_kind,result,model_metadata,revision,
      created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)`,
      [
        record.id,
        userA,
        record.reviewState,
        record.source.type,
        record.source.title,
        record.sourceText,
        record.sourceNormalizedHash,
        record.selectionKind,
        JSON.stringify(record.result),
        JSON.stringify(record.modelMetadata),
        record.revision,
        record.createdAt,
        record.updatedAt,
      ],
    );
    await database.query(
      `INSERT INTO analysis_candidates(id,analysis_id,owner_user_id,candidate_type,
      payload,analysis_unit_id,ordinal) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        candidateId,
        analysisId,
        userA,
        record.candidates[0]?.type,
        JSON.stringify(record.candidates[0]?.payload),
        "u1",
        0,
      ],
    );
  });
  afterEach(async () => database.close());

  it("creates and replays an expression confirmation with immutable trusted source", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "unused",
      priceVersionId: "50000000-0000-0000-0000-000000000001",
    });
    const command: ConfirmCandidatesCommand = {
      analysisId,
      expectedRevision: 1,
      idempotencyKey: "confirm-1",
      requestHash: "a".repeat(64),
      updatedAt: "2026-08-13T00:00:00.000Z",
      userId: userA,
      entries: [
        {
          action: "created",
          candidateId,
          canonicalKey: "to be frank",
          content: contractFixtures.confirmCandidatesRequest.confirmations[0].payload,
          source: {
            analysisId,
            analysisUnitId: "u1",
            sourceText: "To be frank, this works.",
            sourceTitle: "Writing notes",
            sourceType: "manual",
            translationZh: "坦率地说，这很有效。",
          },
          sourceExampleId: "30000000-0000-0000-0000-000000000001",
          systemAttributes: ["discourse-marker"],
          tags: [
            {
              displayName: "Writing",
              id: "40000000-0000-0000-0000-000000000001",
              normalizedName: "writing",
            },
          ],
          targetId: "50000000-0000-0000-0000-000000000001",
          type: "expression",
        },
      ],
    };
    const response = await store.confirmCandidates(command);
    expect(response).toMatchObject({
      analysis: { reviewState: "reviewed", revision: 2 },
      results: [
        {
          action: "created",
          item: {
            content: { meaningZh: "坦率地说" },
            sourceExamples: [
              { sourceText: "To be frank, this works.", translationZh: "坦率地说，这很有效。" },
            ],
          },
        },
      ],
    });
    await expect(store.confirmCandidates(command)).resolves.toEqual(response);
    await expect(
      store.confirmCandidates({ ...command, requestHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(
      store.confirmCandidates({ ...command, userId: userB, idempotencyKey: "other" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await database.query("DELETE FROM analysis_records WHERE id=$1", [analysisId]);
    await expect(
      store.replayCandidateConfirmation({
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
        userId: command.userId,
      }),
    ).resolves.toEqual(response);
  });

  it("rolls back the whole batch when a later merge target is invalid", async () => {
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "unused",
      priceVersionId: "50000000-0000-0000-0000-000000000001",
    });
    const baseSource = {
      analysisId,
      analysisUnitId: "u1",
      sourceText: "To be frank, this works.",
      sourceType: "manual" as const,
    };
    const command: ConfirmCandidatesCommand = {
      analysisId,
      expectedRevision: 1,
      idempotencyKey: "rollback",
      requestHash: "c".repeat(64),
      updatedAt: "2026-08-13T00:00:00.000Z",
      userId: userA,
      entries: [
        {
          action: "created",
          candidateId,
          canonicalKey: "to be frank",
          content: contractFixtures.confirmCandidatesRequest.confirmations[0].payload,
          source: baseSource,
          sourceExampleId: "31000000-0000-0000-0000-000000000001",
          systemAttributes: [],
          tags: [],
          targetId: "51000000-0000-0000-0000-000000000001",
          type: "expression",
        },
        {
          action: "created",
          candidateId: wordCandidateId,
          canonicalKey: "invalid second candidate",
          content: contractFixtures.confirmCandidatesRequest.confirmations[0].payload,
          source: baseSource,
          sourceExampleId: "32000000-0000-0000-0000-000000000001",
          systemAttributes: [],
          tags: [],
          targetId: "52000000-0000-0000-0000-000000000001",
          type: "expression",
        },
      ],
    };
    await expect(store.confirmCandidates(command)).rejects.toMatchObject({
      code: "invalid_request",
    });
    const state = await database.query<{ item_count: number; review_state: string }>(`SELECT
      (SELECT count(*)::integer FROM learning_items) item_count,
      (SELECT review_state FROM analysis_records WHERE id='${analysisId}') review_state`);
    expect(state.rows[0]).toEqual({ item_count: 0, review_state: "pendingReview" });
  });

  it("merges only an exact owned item without overwriting its core fields", async () => {
    const targetId = "53000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,
      system_attributes,created_at,updated_at) VALUES('${targetId}','${userA}','expression',
      'to be frank','{"type":"expression","text":"to be frank","meaningZh":"原含义",
      "usageZh":"原用法"}','["existing"]','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${targetId}','${userA}',-1,NULL);`);
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "unused",
      priceVersionId: "50000000-0000-0000-0000-000000000001",
    });
    const command: ConfirmCandidatesCommand = {
      analysisId,
      entries: [
        {
          action: "merged",
          candidateId,
          canonicalKey: "to be frank",
          content: contractFixtures.confirmCandidatesRequest.confirmations[0].payload,
          source: {
            analysisId,
            analysisUnitId: "u1",
            sourceText: "To be frank, this works.",
            sourceType: "manual",
          },
          sourceExampleId: "33000000-0000-0000-0000-000000000001",
          systemAttributes: ["new"],
          tags: [],
          targetId,
          type: "expression",
        },
      ],
      expectedRevision: 1,
      idempotencyKey: "merge",
      requestHash: "d".repeat(64),
      updatedAt: "2026-08-13T00:00:00.000Z",
      userId: userA,
    };
    await expect(store.confirmCandidates(command)).resolves.toMatchObject({
      results: [
        {
          action: "merged",
          item: {
            content: { meaningZh: "原含义", usageZh: "原用法" },
            revision: 2,
            sourceExamples: [{ sourceText: "To be frank, this works." }],
            systemAttributes: ["existing", "new"],
          },
        },
      ],
    });
  });

  it("returns exact_duplicate and rolls back earlier entries in the batch", async () => {
    const existingId = "54000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,
      system_attributes,created_at,updated_at) VALUES('${existingId}','${userA}','expression',
      'to be frank','{"type":"expression","text":"to be frank","meaningZh":"已有",
      "usageZh":"已有"}','[]','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z');`);
    const store = createPostgresAnalysisStore({
      database: adapter,
      ledgerId: () => "unused",
      priceVersionId: "50000000-0000-0000-0000-000000000001",
    });
    await expect(
      store.confirmCandidates({
        analysisId,
        entries: [
          {
            action: "created",
            candidateId,
            canonicalKey: "to be frank",
            content: contractFixtures.confirmCandidatesRequest.confirmations[0].payload,
            source: {
              analysisId,
              analysisUnitId: "u1",
              sourceText: "To be frank, this works.",
              sourceType: "manual",
            },
            sourceExampleId: "35000000-0000-0000-0000-000000000001",
            systemAttributes: [],
            tags: [],
            targetId: "56000000-0000-0000-0000-000000000001",
            type: "expression",
          },
        ],
        expectedRevision: 1,
        idempotencyKey: "exact-duplicate",
        requestHash: "e".repeat(64),
        updatedAt: "2026-08-13T00:00:00.000Z",
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "exact_duplicate" });
    const state = await database.query<{ item_count: number; review_state: string }>(`SELECT
      (SELECT count(*)::integer FROM learning_items) item_count,
      (SELECT review_state FROM analysis_records WHERE id='${analysisId}') review_state`);
    expect(state.rows[0]).toEqual({ item_count: 1, review_state: "pendingReview" });
  });
});
