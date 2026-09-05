import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeRepository } from "./practice-module.js";
import { beginPracticeWrite, savePracticeWrite } from "./postgres-practice-idempotency.js";
import {
  findPracticeItem as practiceItem,
  loadPracticeSession as loadSession,
} from "./postgres-practice-view.js";

interface AttemptRow {
  current_generation_id: string | null;
  feedback: string | null;
}

interface TaskRow {
  lease_expires_at: Date;
  lease_token: string;
  state: "abandoned" | "applied" | "claimed" | "dispatched" | "failed" | "ready" | "reserved";
}

async function claimItem(tenant: AnalysisQuery, sessionId: string) {
  const session = await loadSession(tenant, sessionId);
  const item = await practiceItem(tenant, session.items[0]?.itemId ?? "");
  if (item === null) throw new CloudFault("not_found", "Learning item not found.");
  return { item, session };
}

export function createPostgresSentenceFeedbackOperations(
  database: AnalysisDatabase,
): Pick<
  PracticeRepository,
  "beginFeedbackRetry" | "completeFeedback" | "recordAttempt" | "releaseFeedbackLease"
> {
  return {
    async beginFeedbackRetry(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await beginPracticeWrite(
          trusted,
          command.ownerUserId,
          "practice.feedback-retry",
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay !== null && replay !== undefined) {
          const restored = practiceSessionResponseSchema.parse(replay);
          const item = await practiceItem(tenant, restored.items[0]?.itemId ?? "");
          if (item === null) throw new CloudFault("not_found", "Learning item not found.");
          return { claimed: false, item, session: restored };
        }
        const sessions = await tenant.rows<{ revision: number; status: string }>(
          "SELECT status,revision FROM practice_sessions WHERE id=$1 AND COALESCE(to_jsonb(practice_sessions)#>>'{workspace_state,phase}','active') IN ('active','paused') FOR UPDATE",
          [command.sessionId],
        );
        if (
          sessions[0]?.status !== "awaiting-feedback" ||
          sessions[0].revision !== command.expectedRevision
        ) {
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        }
        const attempts = await tenant.rows<AttemptRow>(
          `SELECT feedback,current_generation_id::text FROM practice_attempts
            WHERE id=$1 AND session_id=$2 FOR UPDATE`,
          [command.attemptId, command.sessionId],
        );
        const attempt = attempts[0];
        if (attempt === undefined || attempt.feedback !== null) {
          throw new CloudFault("revision_conflict", "Practice attempt changed.");
        }
        let generationId = command.generationId;
        const leaseToken = command.feedbackLeaseToken;
        if (attempt.current_generation_id !== null) {
          const tasks = await tenant.rows<TaskRow>(
            `SELECT state,lease_token,lease_expires_at FROM practice_generation_tasks
              WHERE id=$1 FOR UPDATE`,
            [attempt.current_generation_id],
          );
          const task = tasks[0];
          if (task !== undefined && task.state === "ready") {
            const current = await claimItem(tenant, command.sessionId);
            return {
              claimed: true,
              generationId: attempt.current_generation_id,
              ...current,
              leaseToken: task.lease_token,
            };
          }
          if (task !== undefined && task.state === "dispatched") {
            const current = await claimItem(tenant, command.sessionId);
            return task.lease_expires_at.getTime() > Date.parse(command.now)
              ? { claimed: false, ...current }
              : {
                  claimed: true,
                  generationId: attempt.current_generation_id,
                  ...current,
                  leaseToken: task.lease_token,
                };
          }
          if (task !== undefined && ["claimed", "reserved"].includes(task.state)) {
            if (task.lease_expires_at.getTime() > Date.parse(command.now)) {
              return { claimed: false, ...(await claimItem(tenant, command.sessionId)) };
            }
            generationId = attempt.current_generation_id;
            await tenant.rows(
              `UPDATE practice_generation_tasks SET lease_token=$2,lease_expires_at=$3,updated_at=$4
                WHERE id=$1 AND state IN ('claimed','reserved')`,
              [generationId, leaseToken, command.feedbackLeaseExpiresAt, command.now],
            );
          }
        }
        if (generationId === command.generationId) {
          await tenant.rows(
            `INSERT INTO practice_generation_tasks(
              id,owner_user_id,session_id,attempt_id,kind,state,request_hash,
              lease_token,lease_expires_at
            ) VALUES($1,$2,$3,$4,'sentence-feedback','claimed',$5,$6,$7)`,
            [
              generationId,
              command.ownerUserId,
              command.sessionId,
              command.attemptId,
              command.requestHash,
              leaseToken,
              command.feedbackLeaseExpiresAt,
            ],
          );
        }
        await tenant.rows(
          `UPDATE practice_attempts SET current_generation_id=$3,feedback_lease_token=$4,
            feedback_lease_expires_at=$5,updated_at=$6 WHERE id=$1 AND session_id=$2`,
          [
            command.attemptId,
            command.sessionId,
            generationId,
            leaseToken,
            command.feedbackLeaseExpiresAt,
            command.now,
          ],
        );
        return {
          claimed: true,
          generationId,
          ...(await claimItem(tenant, command.sessionId)),
          leaseToken,
        };
      });
    },
    async completeFeedback(command) {
      return database.transaction(command.ownerUserId, async ({ tenant }) => {
        const tasks = await tenant.rows<{ id: string }>(
          `UPDATE practice_generation_tasks SET state='applied',output=NULL,updated_at=$5
            WHERE id=$1 AND session_id=$2 AND attempt_id=$3 AND lease_token=$4
            AND kind='sentence-feedback' AND state='ready'
            AND output->>'feedback'=$6 RETURNING id::text`,
          [
            command.generationId,
            command.sessionId,
            command.attemptId,
            command.feedbackLeaseToken,
            command.now,
            command.feedback,
          ],
        );
        if (tasks[0] === undefined) {
          const current = await loadSession(tenant, command.sessionId);
          if (current.finalFeedback !== command.feedback) {
            throw new CloudFault("revision_conflict", "Practice feedback changed.");
          }
          return current;
        }
        const updated = await tenant.rows<{ id: string }>(
          `UPDATE practice_attempts SET feedback=$3,feedback_lease_token=NULL,
            feedback_lease_expires_at=NULL,current_generation_id=NULL,updated_at=$4
            WHERE id=$1 AND session_id=$2 AND feedback IS NULL AND feedback_lease_token=$5
            AND current_generation_id=$6 RETURNING id::text`,
          [
            command.attemptId,
            command.sessionId,
            command.feedback,
            command.now,
            command.feedbackLeaseToken,
            command.generationId,
          ],
        );
        if (updated[0] === undefined) {
          throw new CloudFault("revision_conflict", "Practice feedback changed.");
        }
        await tenant.rows(
          `UPDATE practice_sessions SET status='completed',final_feedback=$2,
            completed_at=COALESCE(completed_at,$3),revision=revision+1,updated_at=$3
            WHERE id=$1 AND status='awaiting-feedback'`,
          [command.sessionId, command.feedback, command.now],
        );
        const response = await loadSession(tenant, command.sessionId);
        if (command.operation === "practice.feedback-retry") {
          await savePracticeWrite(tenant, command, command.operation, response);
        } else {
          await tenant.rows(
            `UPDATE idempotency_records SET response=$4::jsonb WHERE owner_user_id=$1
              AND operation=$2 AND key=$3`,
            [
              command.ownerUserId,
              command.operation,
              command.idempotencyKey,
              JSON.stringify(response),
            ],
          );
        }
        return response;
      });
    },
    async recordAttempt(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await beginPracticeWrite(
          trusted,
          command.ownerUserId,
          "practice.attempt",
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay !== null && replay !== undefined) {
          const restored = practiceSessionResponseSchema.parse(replay);
          const item = await practiceItem(tenant, restored.items[0]?.itemId ?? "");
          if (item === null) throw new CloudFault("not_found", "Learning item not found.");
          return { claimed: false, item, session: restored };
        }
        const sessions = await tenant.rows<{ revision: number; status: string }>(
          "SELECT status,revision FROM practice_sessions WHERE id=$1 AND COALESCE(to_jsonb(practice_sessions)#>>'{workspace_state,phase}','active') IN ('active','paused') FOR UPDATE",
          [command.sessionId],
        );
        if (sessions[0]?.status !== "active" || sessions[0].revision !== command.expectedRevision) {
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        }
        await tenant.rows(
          `INSERT INTO practice_attempts(
            id,session_id,owner_user_id,answer,submitted_at,feedback_lease_token,
            feedback_lease_expires_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            command.attemptId,
            command.sessionId,
            command.ownerUserId,
            command.answer,
            command.now,
            command.feedbackLeaseToken,
            command.feedbackLeaseExpiresAt,
          ],
        );
        await tenant.rows(
          `INSERT INTO practice_generation_tasks(
            id,owner_user_id,session_id,attempt_id,kind,state,request_hash,
            lease_token,lease_expires_at
          ) VALUES($1,$2,$3,$4,'sentence-feedback','claimed',$5,$6,$7)`,
          [
            command.generationId,
            command.ownerUserId,
            command.sessionId,
            command.attemptId,
            command.requestHash,
            command.feedbackLeaseToken,
            command.feedbackLeaseExpiresAt,
          ],
        );
        await tenant.rows(
          `UPDATE practice_sessions SET status='awaiting-feedback',revision=revision+1,updated_at=$2
            WHERE id=$1`,
          [command.sessionId, command.now],
        );
        await tenant.rows("UPDATE practice_attempts SET current_generation_id=$2 WHERE id=$1", [
          command.attemptId,
          command.generationId,
        ]);
        const current = await claimItem(tenant, command.sessionId);
        await savePracticeWrite(tenant, command, "practice.attempt", current.session);
        return {
          claimed: true,
          generationId: command.generationId,
          ...current,
          leaseToken: command.feedbackLeaseToken,
        };
      });
    },
    async releaseFeedbackLease(command) {
      await database.transaction(command.ownerUserId, ({ tenant }) =>
        tenant.rows(
          `UPDATE practice_attempts SET feedback_lease_token=NULL,feedback_lease_expires_at=NULL,
            updated_at=$4 WHERE id=$1 AND session_id=$2 AND feedback IS NULL
            AND feedback_lease_token=$3`,
          [command.attemptId, command.sessionId, command.feedbackLeaseToken, command.now],
        ),
      );
    },
  };
}
