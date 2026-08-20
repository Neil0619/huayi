import {
  dailyPracticeQueueResponseSchema,
  practiceRatingsRequestSchema,
  practiceSessionResponseSchema,
  rateSchedule,
  scheduleStateSchema,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeRepository } from "./practice-module.js";
import {
  findPracticeItem as practiceItem,
  loadPracticeSession as loadSession,
  mapPracticeItem as mapItem,
  practiceItemView as itemView,
  requireActiveProfile as requireActive,
  type PracticeItemRow,
} from "./postgres-practice-view.js";
import { createPostgresSentencePromptOperations } from "./postgres-sentence-prompt.js";
import { beginPracticeWrite, savePracticeWrite } from "./postgres-practice-idempotency.js";
import { createPostgresSentenceFeedbackOperations } from "./postgres-sentence-feedback.js";

export function createPostgresPracticeRepository(database: AnalysisDatabase): PracticeRepository {
  return {
    ...createPostgresSentenceFeedbackOperations(database),
    ...createPostgresSentencePromptOperations(database),
    async dailyQueue(ownerUserId, now) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const profile = await requireActive(tenant, ownerUserId);
        const localDates = await tenant.rows<{ date: string }>(
          "SELECT (($1::timestamptz AT TIME ZONE $2)::date)::text AS date",
          [now, profile.timezone],
        );
        const date = localDates[0]?.date;
        if (date === undefined) throw new CloudFault("invalid_request", "Local date unavailable.");
        const rows = await tenant.rows<PracticeItemRow>(
          `${itemView} WHERE items.archived_at IS NULL AND (schedule.level=-1 OR
            (schedule.level>=0 AND schedule.due_at < (($1::date + 1)::timestamp AT TIME ZONE $2)))
            ORDER BY CASE WHEN schedule.level=-1 THEN 1 ELSE 0 END,items.created_at,items.id
            LIMIT $3`,
          [date, profile.timezone, profile.daily_goal],
        );
        const current = await tenant.rows<{ id: string }>(
          `SELECT id::text FROM practice_sessions
            WHERE status IN ('active','awaiting-feedback') OR
              (status='completed' AND EXISTS (
                SELECT 1 FROM practice_session_items links
                WHERE links.session_id=practice_sessions.id AND links.rating IS NULL
              ))
            ORDER BY created_at,id LIMIT 1`,
        );
        const currentSession =
          current[0] === undefined ? null : await loadSession(tenant, current[0].id);
        const currentItems =
          currentSession === null
            ? []
            : await Promise.all(
                currentSession.items.map((item) => practiceItem(tenant, item.itemId)),
              );
        if (currentItems.some((item) => item === null)) {
          throw new CloudFault("not_found", "Practice item not found.");
        }
        return dailyPracticeQueueResponseSchema.parse({
          currentItems,
          currentSession,
          dailyGoal: profile.daily_goal,
          date,
          items: rows.map(mapItem),
          timezone: profile.timezone,
        });
      });
    },
    async findPracticeItem(ownerUserId, itemId) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        await requireActive(tenant, ownerUserId);
        return practiceItem(tenant, itemId);
      });
    },
    async rate(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await beginPracticeWrite(
          trusted,
          command.ownerUserId,
          "practice.rate",
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay !== null && replay !== undefined)
          return practiceSessionResponseSchema.parse(replay);
        const input = practiceRatingsRequestSchema.parse(command.input);
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [
          command.sessionId,
        ]);
        const session = await loadSession(tenant, command.sessionId);
        if (session.status !== "completed" || session.finalFeedback === undefined) {
          throw new CloudFault("revision_conflict", "Practice feedback is not complete.");
        }
        if (
          input.ratings.length !== session.items.length ||
          session.items.some(
            (sessionItem) =>
              !input.ratings.some((requested) => requested.itemId === sessionItem.itemId),
          )
        ) {
          throw new CloudFault("invalid_request", "Practice rating item is invalid.");
        }
        const alreadyRated = session.items.every((item) => item.rating !== undefined);
        if (alreadyRated) {
          if (
            session.items.some(
              (item) =>
                item.rating !==
                input.ratings.find((requested) => requested.itemId === item.itemId)?.rating,
            )
          ) {
            throw new CloudFault("idempotency_conflict", "Practice rating already differs.");
          }
          await savePracticeWrite(trusted, command, "practice.rate", session);
          return session;
        }
        if (session.revision !== input.expectedRevision) {
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        }
        for (const requested of input.ratings) {
          const sessionItem = session.items.find((item) => item.itemId === requested.itemId);
          if (sessionItem === undefined || sessionItem.rating !== undefined) {
            throw new CloudFault("revision_conflict", "Practice rating state changed.");
          }
          const before = scheduleStateSchema.parse(sessionItem.scheduleBefore);
          const after = rateSchedule(before, requested.rating, command.now);
          await tenant.rows(
            `UPDATE schedule_states SET level=$2,due_at=$3,last_rating=$4,
              consecutive_mastered=$5,updated_at=$6 WHERE learning_item_id=$1`,
            [
              requested.itemId,
              after.level,
              after.dueAt,
              requested.rating,
              after.consecutiveMastered,
              command.now,
            ],
          );
          await tenant.rows(
            `UPDATE practice_session_items SET rating=$3,schedule_after=$4::jsonb
              WHERE session_id=$1 AND learning_item_id=$2`,
            [command.sessionId, requested.itemId, requested.rating, JSON.stringify(after)],
          );
        }
        await tenant.rows(
          "UPDATE practice_sessions SET revision=revision+1,updated_at=$2 WHERE id=$1",
          [command.sessionId, command.now],
        );
        const response = await loadSession(tenant, command.sessionId);
        await savePracticeWrite(trusted, command, "practice.rate", response);
        return response;
      });
    },
  };
}
