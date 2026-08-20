import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createAccountDataRightsModule } from "./account-data-rights-module.js";
import { createPostgresAccountDataRights } from "./postgres-account-data-rights.js";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const ownerA = "00000000-0000-0000-0000-00000000000a";
const ownerB = "00000000-0000-0000-0000-00000000000b";
const completedGenerationId = "40000000-0000-4000-8000-000000000003";

const completedQueryEvent = {
  generationId: completedGenerationId,
  quota: {
    availableMicroUsd: 900,
    limitMicroUsd: 1_000,
    percentUsed: 10,
    periodEnd: "2026-09-01T00:00:00.000Z",
    periodStart: "2026-08-01T00:00:00.000Z",
    reservedMicroUsd: 0,
    usedMicroUsd: 100,
    warning: "available",
  },
  result: {
    contextRole: "谓语",
    keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
    mainStructure: "主语 + 谓语",
    requestId: completedGenerationId,
    selectionKind: "sentence",
    sourceText: "The plan fell through again.",
    translationZh: "计划又落空了。",
    type: "explain-sentence",
  },
  type: "query.completed",
};

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres account data rights", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let nextId: number;
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
        return database.transaction((transaction) => operation(query(transaction)));
      },
    };
    nextId = 1;
    await database.exec(`
      INSERT INTO user_profiles(
        user_id,owner_user_id,email,status,timezone,daily_goal,extension_query_model_mode,
        study_capture_mode,cloud_word_copy_mode,preferences_revision,created_at,updated_at
      ) VALUES('${ownerA}','${ownerA}','a@example.test','active','UTC',5,'byok',
        'automatic','disabled',3,'2026-08-12T00:00:00Z','2026-08-13T00:30:00Z'),
        ('${ownerB}','${ownerB}','b@example.test','active','UTC',5,'platform',
         'manual','enabled',1,'2026-08-12T00:00:00Z','2026-08-12T00:00:00Z');
      INSERT INTO account_sign_in_methods(owner_user_id,method,linked_at)
      VALUES('${ownerA}','password','2026-08-12T00:05:00Z');
      INSERT INTO web_sessions(
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at
      ) VALUES('10000000-0000-4000-8000-000000000001','${ownerA}','${ownerA}',
        'session-a','csrf-a','refresh-a','2026-08-14T00:00:00Z');
      INSERT INTO extension_sessions(
        id,user_id,owner_user_id,install_id_hash,token_hash,device_label,expires_at
      ) VALUES('10000000-0000-4000-8000-000000000002','${ownerA}','${ownerA}',
        'install-a','token-a','Device A','2026-08-14T00:00:00Z');
      INSERT INTO extension_pairings(
        id,user_id,owner_user_id,state_hash,pkce_challenge,install_id_hash,status,expires_at
      ) VALUES('10000000-0000-4000-8000-000000000003','${ownerA}','${ownerA}',
        'state-a','challenge-a','install-a','approved','2026-08-14T00:00:00Z');
      INSERT INTO study_captures(
        id,owner_user_id,selection_kind,source_text,normalized_text_hash,status,
        first_captured_at,last_captured_at,capture_count,created_at,updated_at
      ) VALUES('30000000-0000-4000-8000-000000000001','${ownerA}','sentence',
        'The plan fell through.','${"a".repeat(64)}','pending',
        '2026-08-13T00:10:00Z','2026-08-13T00:20:00Z',2,
        '2026-08-13T00:10:00Z','2026-08-13T00:20:00Z');
      INSERT INTO learning_items(
        id,owner_user_id,type,canonical_key,content,archived_at,created_at,updated_at
      ) VALUES('60000000-0000-4000-8000-000000000001','${ownerA}','expression','fell through',
        '{"type":"expression","text":"fell through","meaningZh":"落空","usageZh":"描述计划失败。"}',
        '2026-08-13T00:35:00Z','2026-08-13T00:30:00Z','2026-08-13T00:35:00Z');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('60000000-0000-4000-8000-000000000001','${ownerA}',1,'2026-08-20T00:00:00Z');
      INSERT INTO learning_items(
        id,owner_user_id,type,canonical_key,content,system_attributes,deleted_at,created_at,updated_at
      ) VALUES('60000000-0000-4000-8000-000000000002','${ownerA}',NULL,NULL,NULL,'[]',
        '2026-08-13T00:45:00Z','2026-08-13T00:31:00Z','2026-08-13T00:45:00Z');
      INSERT INTO practice_sessions(
        id,owner_user_id,type,status,prompt,final_feedback,completed_at,revision,created_at,updated_at
      ) VALUES('90000000-0000-4000-8000-000000000001','${ownerA}','sentence-creation',
        'completed','Write.','Good.','2026-08-13T00:44:00Z',3,
        '2026-08-13T00:40:00Z','2026-08-13T00:44:00Z');
      INSERT INTO practice_session_items(
        session_id,learning_item_id,owner_user_id,position,rating,schedule_before,schedule_after
      ) VALUES('90000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000002','${ownerA}',0,'mastered',
        '{"level":-1,"dueAt":null,"consecutiveMastered":0}',
        '{"level":0,"dueAt":"2026-08-14T00:00:00.000Z","consecutiveMastered":1,"lastRating":"mastered"}');
      INSERT INTO extension_query_generations(
        id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,
        lease_expires_at,expires_at,created_at,updated_at
      ) VALUES
        ('40000000-0000-4000-8000-000000000001','${ownerA}','query-live',
         '${"b".repeat(64)}','running',
         '{"action":"explain","selectionKind":"sentence","sourceText":"The plan fell through.","sourceType":"web-selection"}',
         'private-lease','2026-08-13T01:02:00Z','2026-08-13T02:00:00Z',
         '2026-08-13T00:40:00Z','2026-08-13T00:40:00Z'),
        ('40000000-0000-4000-8000-000000000002','${ownerA}','query-expired',
         '${"c".repeat(64)}','running',
         '{"action":"translate","selectionKind":"sentence","sourceText":"Expired.","sourceType":"web-selection"}',
         'private-lease','2026-08-13T00:20:00Z','2026-08-13T00:30:00Z',
         '2026-08-13T00:00:00Z','2026-08-13T00:00:00Z');
    `);
    await database.query(
      `INSERT INTO extension_query_generations(
        id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,
        lease_expires_at,terminal_event,expires_at,created_at,updated_at
      ) VALUES($1,$2,'query-completed',$3,'completed',$4::jsonb,'private-completed-lease',
        '2026-08-13T00:52:00Z',$5::jsonb,'2026-08-13T02:00:00Z',
        '2026-08-13T00:50:00Z','2026-08-13T00:50:00Z')`,
      [
        completedGenerationId,
        ownerA,
        "d".repeat(64),
        JSON.stringify({
          action: "explain",
          selectionKind: "sentence",
          sourceText: "The plan fell through again.",
          sourceType: "youtube-caption",
        }),
        JSON.stringify(completedQueryEvent),
      ],
    );
  });
  afterEach(async () => database.close());

  function module() {
    return createAccountDataRightsModule({
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository: createPostgresAccountDataRights(adapter, {
        id: () => `20000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
        pepper: "test-pepper-with-at-least-thirty-two-characters",
      }),
      signedUrls: { create: async () => ({ url: "https://example.test/signed" }) },
    });
  }

  it("keeps one owner-scoped open export and replays the same write", async () => {
    const rights = module();
    const created = await rights.requestExport(ownerA, "create-1", {});
    await expect(rights.requestExport(ownerA, "create-1", {})).resolves.toEqual(created);
    await expect(rights.requestExport(ownerA, "create-2", {})).resolves.toEqual(created);
    await expect(rights.currentExport(ownerB)).resolves.toBeNull();
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*)::int count FROM account_data_export_jobs",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("builds a strict owner snapshot without authority fields", async () => {
    const records = await createPostgresAccountDataExportSource(adapter).records(
      ownerA,
      "2026-08-13T01:00:00.000Z",
    );
    expect(records).toEqual([
      expect.objectContaining({
        cloudWordCopyMode: "disabled",
        dailyGoal: 5,
        extensionQueryModelMode: "byok",
        recordType: "account-preferences",
        revision: 3,
        studyCaptureMode: "automatic",
        timezone: "UTC",
      }),
      {
        methods: [{ linkedAt: "2026-08-12T00:05:00.000Z", method: "password" }],
        recordType: "account-sign-in-methods",
      },
      expect.objectContaining({
        action: "explain",
        id: "40000000-0000-4000-8000-000000000001",
        recordType: "extension-query-generation",
        sourceText: "The plan fell through.",
        state: "running",
      }),
      expect.objectContaining({
        id: completedGenerationId,
        recordType: "extension-query-generation",
        result: expect.objectContaining({ translationZh: "计划又落空了。" }),
        state: "completed",
      }),
      expect.objectContaining({
        capture: expect.objectContaining({
          captureCount: 2,
          id: "30000000-0000-4000-8000-000000000001",
          sourceText: "The plan fell through.",
        }),
        latestAnalysis: null,
        recordType: "study-capture",
      }),
      expect.objectContaining({
        archivedAt: "2026-08-13T00:35:00.000Z",
        item: expect.objectContaining({ id: "60000000-0000-4000-8000-000000000001" }),
        recordType: "learning-item",
        schedule: expect.objectContaining({ level: 1 }),
      }),
      expect.objectContaining({
        recordType: "practice-session",
        session: expect.objectContaining({
          items: [
            expect.objectContaining({
              itemId: "60000000-0000-4000-8000-000000000002",
              learningItemDeletedAt: "2026-08-13T00:45:00.000Z",
            }),
          ],
        }),
      }),
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(ownerA);
    expect(serialized).not.toContain("a@example.test");
    expect(serialized).not.toContain("private-lease");
    expect(serialized).not.toContain("private-completed-lease");
    expect(serialized).not.toContain("availableMicroUsd");
    expect(serialized).not.toContain("Expired.");
  });

  it("atomically marks deleting, revokes every session, and replays its fixed receipt", async () => {
    const rights = module();
    const accepted = await rights.requestDeletion(
      ownerA,
      "delete-1",
      "presented-session-proof",
      new Date("2026-08-13T00:59:00.000Z"),
      { confirmation: "delete-account" },
    );
    await expect(
      rights.requestDeletion(
        ownerA,
        "delete-1",
        "presented-session-proof",
        new Date("2026-08-13T00:59:00.000Z"),
        { confirmation: "delete-account" },
      ),
    ).resolves.toEqual(accepted);
    expect(
      (
        await database.query<{ status: string }>(
          "SELECT status FROM user_profiles WHERE user_id=$1",
          [ownerA],
        )
      ).rows,
    ).toEqual([{ status: "deleting" }]);
    expect(
      (
        await database.query<{ count: number }>(
          `SELECT count(*)::int count FROM web_sessions WHERE revoked_at IS NULL
         UNION ALL SELECT count(*)::int FROM extension_sessions WHERE revoked_at IS NULL
         UNION ALL SELECT count(*)::int FROM extension_pairings WHERE status <> 'expired'`,
        )
      ).rows,
    ).toEqual([{ count: 0 }, { count: 0 }, { count: 0 }]);
  });

  it("fences export publication and durably completes ordered account deletion", async () => {
    const rights = module();
    await rights.requestExport(ownerA, "create-worker-export", {});
    const deletedObjects: string[][] = [];
    const worker = createAccountDataRightsWorker({
      authority: {
        deleteAuthUser: async () => undefined,
        deleteObjects: async (keys) => {
          deletedObjects.push(keys);
        },
        upload: async () => undefined,
      },
      exportSource: {
        records: async () => [
          {
            cloudWordCopyMode: "disabled" as const,
            createdAt: "2026-08-13T00:00:00.000Z",
            dailyGoal: 5,
            extensionQueryModelMode: "byok" as const,
            recordType: "account-preferences" as const,
            revision: 3,
            studyCaptureMode: "automatic" as const,
            timezone: "UTC",
            updatedAt: "2026-08-13T00:30:00.000Z",
          },
        ],
      },
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository: createPostgresAccountDataRightsWorker(adapter, {
        clock: new MutableClock("2026-08-13T01:00:00.000Z"),
        pepper: "test-pepper-with-at-least-thirty-two-characters",
        secrets: new DeterministicSecrets(),
      }),
    });
    await expect(worker.runOne()).resolves.toEqual({ deletion: "idle", export: "processed" });
    await expect(rights.currentExport(ownerA)).resolves.toMatchObject({ state: "ready" });

    await rights.requestDeletion(
      ownerA,
      "delete-after-export",
      "presented-session-proof",
      new Date("2026-08-13T00:59:00.000Z"),
      { confirmation: "delete-account" },
    );
    await expect(worker.runOne()).resolves.toEqual({ deletion: "processed", export: "idle" });
    expect(deletedObjects.at(-1)).toEqual([
      expect.stringMatching(/^account-exports\/.+\.ndjson$/u),
    ]);
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*)::int count FROM user_profiles WHERE user_id=$1",
          [ownerA],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await database.query<{ state: string; subject_user_id: string | null }>(
          "SELECT state,subject_user_id::text FROM account_deletion_jobs",
        )
      ).rows,
    ).toEqual([{ state: "completed", subject_user_id: null }]);
  });
});
