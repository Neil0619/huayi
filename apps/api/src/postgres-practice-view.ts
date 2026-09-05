import {
  dailyPracticeQueueItemSchema,
  practiceSessionResponseSchema,
  type PracticeSession,
} from "@huayi/cloud-contracts";

import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeItem } from "./practice-module.js";

interface SessionRow {
  workspace_state: unknown;
  created_at: Date;
  dialogue_plan: unknown;
  final_feedback: string | null;
  id: string;
  item_feedbacks: unknown;
  pending_generation:
    "assistant-turn" | "dialogue-start" | "final-feedback" | "sentence-prompt" | null;
  prompt: string | null;
  revision: number;
  status: "active" | "awaiting-feedback" | "completed" | "failed";
  type: "dialogue" | "sentence-creation";
  updated_at: Date;
}
interface SessionItemRow {
  deleted_at: Date | null;
  learning_item_id: string;
  position: number;
  rating: "effortful" | "forgot" | "mastered" | null;
  schedule_after: unknown;
  schedule_before: unknown;
}
interface AttemptRow {
  answer: string;
  feedback: string | null;
  id: string;
  submitted_at: Date;
}
interface TurnRow {
  content: string;
  created_at: Date;
  id: string;
  ordinal: number;
  role: "assistant" | "user";
}
export interface PracticeItemRow {
  archived_at: Date | null;
  consecutive_mastered: number;
  content: unknown;
  due_at: Date | null;
  id: string;
  last_rating: "effortful" | "forgot" | "mastered" | null;
  level: number;
  system_attributes: string[];
  tags: string[];
  type: "expression" | "sentence-pattern";
}

export const practiceItemView = `SELECT items.id::text,items.type,items.content,
  items.system_attributes,items.archived_at,
  schedule.level,schedule.due_at,schedule.consecutive_mastered,schedule.last_rating,
  COALESCE((SELECT jsonb_agg(tags.display_name ORDER BY tags.normalized_name)
    FROM learning_item_tags joins JOIN tags ON tags.id=joins.tag_id
    WHERE joins.learning_item_id=items.id),'[]'::jsonb) tags
  FROM learning_items items JOIN schedule_states schedule
    ON schedule.learning_item_id=items.id AND items.deleted_at IS NULL`;

export function mapPracticeItem(row: PracticeItemRow): PracticeItem {
  return dailyPracticeQueueItemSchema.parse({
    item: {
      content: row.content,
      id: row.id,
      systemAttributes: row.system_attributes,
      tags: row.tags,
      type: row.type,
    },
    schedule: {
      consecutiveMastered: row.consecutive_mastered,
      dueAt: row.due_at?.toISOString() ?? null,
      ...(row.last_rating === null ? {} : { lastRating: row.last_rating }),
      level: row.level,
    },
  });
}

export async function loadPracticeSession(
  query: AnalysisQuery,
  sessionId: string,
): Promise<PracticeSession> {
  const rows = await query.rows<SessionRow>(
    `SELECT id::text,type,status,prompt,dialogue_plan,final_feedback,item_feedbacks,
      pending_generation,revision,created_at,updated_at
      ,to_jsonb(practice_sessions)->'workspace_state' AS workspace_state FROM practice_sessions WHERE id=$1`,
    [sessionId],
  );
  const row = rows[0];
  if (row === undefined) throw new CloudFault("not_found", "Practice session not found.");
  const [items, attempts, turns] = await Promise.all([
    query.rows<SessionItemRow>(
      `SELECT links.learning_item_id::text,links.position,links.rating,links.schedule_before,
        links.schedule_after,items.deleted_at FROM practice_session_items links
        JOIN learning_items items ON items.id=links.learning_item_id
        WHERE links.session_id=$1 ORDER BY links.position`,
      [sessionId],
    ),
    query.rows<AttemptRow>(
      `SELECT id::text,answer,feedback,submitted_at FROM practice_attempts
        WHERE session_id=$1 ORDER BY submitted_at,id`,
      [sessionId],
    ),
    query.rows<TurnRow>(
      `SELECT id::text,ordinal,role,content,created_at FROM practice_turns
        WHERE session_id=$1 ORDER BY ordinal`,
      [sessionId],
    ),
  ]);
  return practiceSessionResponseSchema.parse({
    ...(attempts.length === 0
      ? {}
      : {
          attempts: attempts.map((attempt) => ({
            answer: attempt.answer,
            ...(attempt.feedback === null ? {} : { feedback: attempt.feedback }),
            id: attempt.id,
            itemIds: items.map((item) => item.learning_item_id),
            submittedAt: attempt.submitted_at.toISOString(),
          })),
        }),
    ...(row.workspace_state == null ? {} : { workspace: row.workspace_state }),
    createdAt: row.created_at.toISOString(),
    ...(row.dialogue_plan === null ? {} : { dialoguePlan: row.dialogue_plan }),
    ...(row.final_feedback === null ? {} : { finalFeedback: row.final_feedback }),
    ...(row.item_feedbacks === null ? {} : { itemFeedbacks: row.item_feedbacks }),
    id: row.id,
    items: items.map((item) => ({
      itemId: item.learning_item_id,
      ...(item.deleted_at === null ? {} : { learningItemDeletedAt: item.deleted_at.toISOString() }),
      position: item.position,
      ...(item.rating === null ? {} : { rating: item.rating }),
      ...(item.schedule_after === null ? {} : { scheduleAfter: item.schedule_after }),
      scheduleBefore: item.schedule_before,
    })),
    ...(row.pending_generation === "dialogue-start" ||
    row.pending_generation === "sentence-prompt" ||
    row.prompt === null
      ? {}
      : { prompt: row.prompt }),
    ...(row.pending_generation === null ? {} : { pendingGeneration: row.pending_generation }),
    revision: row.revision,
    status: row.status,
    turns: turns.map((turn) => ({
      content: turn.content,
      createdAt: turn.created_at.toISOString(),
      id: turn.id,
      ordinal: turn.ordinal,
      role: turn.role,
    })),
    type: row.type,
    updatedAt: row.updated_at.toISOString(),
  });
}

export async function requireActiveProfile(query: AnalysisQuery, ownerUserId: string) {
  const rows = await query.rows<{ daily_goal: number; status: string; timezone: string }>(
    "SELECT status,timezone,daily_goal FROM user_profiles WHERE user_id=$1",
    [ownerUserId],
  );
  if (rows[0]?.status !== "active") throw new CloudFault("forbidden", "Account is not active.");
  return rows[0];
}

export async function findPracticeItem(query: AnalysisQuery, id: string) {
  const rows = await query.rows<PracticeItemRow>(`${practiceItemView} WHERE items.id=$1`, [id]);
  return rows[0] === undefined ? null : mapPracticeItem(rows[0]);
}

export async function requireActivePracticeItem(
  query: AnalysisQuery,
  id: string,
  options: { lock?: boolean } = {},
) {
  const rows = await query.rows<PracticeItemRow>(
    `${practiceItemView} WHERE items.id=$1${options.lock === true ? " FOR UPDATE OF items" : ""}`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new CloudFault("not_found", "Learning item not found.");
  if (row.archived_at !== null) {
    throw new CloudFault("learning_item_archived", "Learning item is archived.");
  }
  return mapPracticeItem(row);
}
