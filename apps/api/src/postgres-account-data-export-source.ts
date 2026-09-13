import {
  accountDataExportRecordReadSchema,
  accountDataExportFormatVersionSchema,
  type AccountDataExportFormatVersion,
  extensionQueryEventReadSchema,
  type AccountDataExportRecordRead,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { accountLearningTimezone } from "./account-learning-timezone.js";
import {
  learningLibraryViewSql,
  mapLearningLibraryView,
  type LibraryRow,
} from "./postgres-learning-library.js";
import { loadPracticeSession } from "./postgres-practice-view.js";
import { loadPracticeTeaching } from "./postgres-practice-teaching-view.js";
import { readStoredQueryRequest } from "./generation-snapshot.js";
import { referenceStateSchema } from "./practice-reference-state.js";

interface WordRow {
  archived_at: Date | null;
  canonical_key: string;
  created_at: Date;
  headword: string;
  id: string;
  notes: string | null;
  revision: number;
  updated_at: Date;
}
interface ContextRow {
  contextual_meaning: string | null;
  id: string;
  observed_at: Date;
  source_text: string | null;
  source_title: string | null;
  source_type: string;
}

interface ExtensionQueryRow {
  created_at: Date;
  expires_at: Date;
  id: string;
  request: unknown;
  state: "completed" | "failed" | "running";
  terminal_event: unknown;
}

interface StudyCaptureRow {
  capture_count: number;
  created_at: Date;
  first_captured_at: Date;
  id: string;
  last_captured_at: Date;
  latest_analysis_created_at: Date | null;
  latest_analysis_id: string | null;
  latest_analysis_review_state: "pendingReview" | "reviewed" | null;
  latest_analysis_revision: number | null;
  normalized_text_hash: string;
  revision: number;
  selection_kind: "passage" | "phrase" | "sentence";
  source_text: string;
  status: "analyzed" | "analyzing" | "pending";
  title: string | null;
  updated_at: Date;
  user_context: string | null;
}

interface SignInMethodRow {
  linked_at: Date;
  method: "google" | "password";
}

async function extensionQueries(
  query: AnalysisQuery,
  snapshotAt: string,
): Promise<AccountDataExportRecordRead[]> {
  const rows = await query.rows<ExtensionQueryRow>(
    `SELECT id::text,state,request,terminal_event,created_at,expires_at
     FROM extension_query_generations WHERE expires_at>$1 ORDER BY created_at,id`,
    [snapshotAt],
  );
  return rows.map((row) => {
    const request = readStoredQueryRequest(row.request);
    const common = {
      ...request,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      id: row.id,
      recordType: "extension-query-generation" as const,
      state: row.state,
    };
    if (row.state === "running") return accountDataExportRecordReadSchema.parse(common);
    const event = extensionQueryEventReadSchema.parse(row.terminal_event);
    if (event.generationId !== row.id) throw new Error("ExtensionQuery export event mismatch.");
    if (row.state === "completed" && event.type === "query.completed") {
      return accountDataExportRecordReadSchema.parse({ ...common, result: event.result });
    }
    if (row.state === "failed" && event.type === "query.failed") {
      return accountDataExportRecordReadSchema.parse({ ...common, error: event.error });
    }
    throw new Error("ExtensionQuery export state mismatch.");
  });
}

async function studyCaptures(query: AnalysisQuery): Promise<AccountDataExportRecordRead[]> {
  const rows = await query.rows<StudyCaptureRow>(
    `SELECT captures.*,
      latest.id::text AS latest_analysis_id,latest.created_at AS latest_analysis_created_at,
      latest.review_state AS latest_analysis_review_state,latest.revision AS latest_analysis_revision
     FROM study_captures captures LEFT JOIN LATERAL (
       SELECT id,created_at,review_state,revision FROM analysis_records
       WHERE study_capture_id=captures.id ORDER BY created_at DESC,id DESC LIMIT 1
     ) latest ON true ORDER BY captures.created_at,captures.id`,
  );
  return rows.map((row) =>
    accountDataExportRecordReadSchema.parse({
      capture: {
        captureCount: row.capture_count,
        createdAt: row.created_at.toISOString(),
        firstCapturedAt: row.first_captured_at.toISOString(),
        id: row.id,
        kind: row.selection_kind,
        lastCapturedAt: row.last_captured_at.toISOString(),
        normalizedTextHash: row.normalized_text_hash,
        revision: row.revision,
        sourceText: row.source_text,
        status: row.status,
        ...(row.title === null ? {} : { title: row.title }),
        updatedAt: row.updated_at.toISOString(),
        ...(row.user_context === null ? {} : { userContext: row.user_context }),
      },
      latestAnalysis:
        row.latest_analysis_id === null ||
        row.latest_analysis_created_at === null ||
        row.latest_analysis_review_state === null ||
        row.latest_analysis_revision === null
          ? null
          : {
              createdAt: row.latest_analysis_created_at.toISOString(),
              id: row.latest_analysis_id,
              reviewState: row.latest_analysis_review_state,
              revision: row.latest_analysis_revision,
            },
      recordType: "study-capture",
    }),
  );
}

async function words(query: AnalysisQuery): Promise<AccountDataExportRecordRead[]> {
  const rows = await query.rows<WordRow>(
    `SELECT id::text,headword,canonical_key,notes,revision,created_at,updated_at,
       (to_jsonb(word_entries)->>'archived_at')::timestamptz AS archived_at
     FROM word_entries ORDER BY created_at,id`,
  );
  const result: AccountDataExportRecordRead[] = [];
  for (const row of rows) {
    const contexts = await query.rows<ContextRow>(
      `SELECT id::text,source_text,source_title,contextual_meaning,source_type,observed_at
       FROM context_observations WHERE word_entry_id=$1 ORDER BY observed_at,id`,
      [row.id],
    );
    result.push(
      accountDataExportRecordReadSchema.parse({
        recordType: "word",
        ...(row.archived_at ? { archivedAt: row.archived_at.toISOString() } : {}),
        word: {
          canonicalKey: row.canonical_key,
          contexts: contexts.map((context) => ({
            ...(context.contextual_meaning === null
              ? {}
              : { contextualMeaningZh: context.contextual_meaning }),
            id: context.id,
            observedAt: context.observed_at.toISOString(),
            ...(context.source_text === null ? {} : { sourceText: context.source_text }),
            ...(context.source_title === null ? {} : { sourceTitle: context.source_title }),
            sourceType: context.source_type,
          })),
          createdAt: row.created_at.toISOString(),
          headword: row.headword,
          id: row.id,
          ...(row.notes === null ? {} : { notes: row.notes }),
          revision: row.revision,
          updatedAt: row.updated_at.toISOString(),
        },
      }),
    );
  }
  return result;
}

export function createPostgresAccountDataExportSource(database: AnalysisDatabase) {
  return {
    async records(
      ownerUserId: string,
      snapshotAt: string,
      formatVersion: AccountDataExportFormatVersion = 2,
    ): Promise<AccountDataExportRecordRead[]> {
      accountDataExportFormatVersionSchema.parse(formatVersion);
      if (formatVersion >= 3 && !database.snapshot)
        throw new Error("Teaching export requires a repeatable-read snapshot.");
      const snapshot = database.snapshot?.bind(database) ?? database.transaction.bind(database);
      return snapshot(ownerUserId, async ({ tenant, trusted }) => {
        const profile = (
          await tenant.rows<{
            cloud_word_copy_mode: "disabled" | "enabled";
            created_at: Date;
            daily_goal: number;
            extension_query_model_mode: "byok" | "platform";
            preferences_revision: number;
            study_capture_mode: "automatic" | "manual";
            updated_at: Date;
          }>(
            `SELECT daily_goal,extension_query_model_mode,study_capture_mode,
             cloud_word_copy_mode,preferences_revision,created_at,updated_at
             FROM user_profiles WHERE user_id=$1`,
            [ownerUserId],
          )
        )[0];
        if (profile === undefined) throw new Error("Export profile is unavailable.");
        const records: AccountDataExportRecordRead[] = [
          accountDataExportRecordReadSchema.parse({
            cloudWordCopyMode: profile.cloud_word_copy_mode,
            createdAt: profile.created_at.toISOString(),
            dailyGoal: profile.daily_goal,
            extensionQueryModelMode: profile.extension_query_model_mode,
            recordType: "account-preferences",
            revision: profile.preferences_revision,
            studyCaptureMode: profile.study_capture_mode,
            timezone: accountLearningTimezone,
            updatedAt: profile.updated_at.toISOString(),
          }),
        ];
        const signInMethods = await tenant.rows<SignInMethodRow>(
          `SELECT method,linked_at FROM account_sign_in_methods
           ORDER BY CASE method WHEN 'password' THEN 0 ELSE 1 END`,
        );
        records.push(
          accountDataExportRecordReadSchema.parse({
            methods: signInMethods.map((method) => ({
              linkedAt: method.linked_at.toISOString(),
              method: method.method,
            })),
            recordType: "account-sign-in-methods",
          }),
        );
        records.push(...(await extensionQueries(tenant, snapshotAt)));
        records.push(...(await studyCaptures(tenant)));
        const analyses = await tenant.rows<{ id: string }>(
          "SELECT id::text FROM analysis_records ORDER BY created_at,id",
        );
        for (const { id } of analyses) {
          const analysis = (
            await trusted.rows<{ value: unknown }>(
              "SELECT huayi_private.owner_analysis_public_record($1,$2) value",
              [ownerUserId, id],
            )
          )[0]?.value;
          records.push(
            accountDataExportRecordReadSchema.parse({ analysis, recordType: "analysis" }),
          );
        }
        const learning = await tenant.rows<LibraryRow>(
          `${learningLibraryViewSql} ORDER BY items.created_at,items.id`,
        );
        for (const row of learning) {
          const detail = mapLearningLibraryView(row);
          records.push(
            accountDataExportRecordReadSchema.parse({
              archivedAt: detail.archivedAt,
              item: detail.item,
              recordType: "learning-item",
              schedule: detail.schedule,
            }),
          );
        }
        records.push(...(await words(tenant)));
        const sessions = await tenant.rows<{ id: string }>(
          "SELECT id::text FROM practice_sessions ORDER BY created_at,id",
        );
        for (const { id } of sessions) {
          if (formatVersion >= 3) {
            const { session, teaching } = await loadPracticeTeaching(tenant, id);
            const raw =
              formatVersion === 4
                ? (
                    await tenant.rows<{ reference_state: unknown }>(
                      "SELECT reference_state FROM practice_sessions WHERE id=$1",
                      [id],
                    )
                  )[0]?.reference_state
                : null;
            const state = raw == null ? null : referenceStateSchema.parse(raw);
            records.push(
              accountDataExportRecordReadSchema.parse({
                recordType: "practice-session",
                session,
                teaching,
                ...(formatVersion === 4
                  ? {
                      reference: state?.result
                        ? { version: 1, result: state.result, views: state.views }
                        : null,
                    }
                  : {}),
              }),
            );
            continue;
          }
          records.push(
            accountDataExportRecordReadSchema.parse({
              recordType: "practice-session",
              session: await loadPracticeSession(tenant, id),
            }),
          );
        }
        return records;
      });
    },
  };
}

export type PostgresAccountDataExportSource = ReturnType<
  typeof createPostgresAccountDataExportSource
>;
