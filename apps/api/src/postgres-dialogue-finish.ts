import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { DialoguePracticeRepository } from "./dialogue-practice-module.js";
import { practiceGenerationOutputSchema } from "./paid-practice-generator.js";
import {
  beginDialogueWrite,
  replaceDialogueWrite,
  saveDialogueWrite,
} from "./postgres-dialogue-practice-support.js";
import { loadPracticeSession } from "./postgres-practice-view.js";

async function claimPendingFinish(
  tenant: AnalysisQuery,
  command: Parameters<DialoguePracticeRepository["beginFinish"]>[0],
) {
  const rows = await tenant.rows<{ current_generation_id: string | null }>(
    "SELECT current_generation_id::text FROM practice_sessions WHERE id=$1 FOR UPDATE",
    [command.sessionId],
  );
  const currentId = rows[0]?.current_generation_id ?? null;
  if (currentId !== null) {
    const tasks = await tenant.rows<{
      lease_expires_at: Date;
      lease_token: string;
      state: string;
    }>(
      "SELECT state,lease_token,lease_expires_at FROM practice_generation_tasks WHERE id=$1 FOR UPDATE",
      [currentId],
    );
    const task = tasks[0];
    const session = await loadPracticeSession(tenant, command.sessionId);
    if (task?.state === "ready") {
      return {
        claimed: true as const,
        generationId: currentId,
        leaseToken: task.lease_token,
        session,
      };
    }
    if (task?.state === "dispatched") {
      return task.lease_expires_at.getTime() > Date.parse(command.now)
        ? { claimed: false as const, session }
        : {
            claimed: true as const,
            generationId: currentId,
            leaseToken: task.lease_token,
            session,
          };
    }
    if (task !== undefined && ["claimed", "reserved"].includes(task.state)) {
      if (task.lease_expires_at.getTime() > Date.parse(command.now)) {
        return { claimed: false as const, session };
      }
      await tenant.rows(
        `UPDATE practice_generation_tasks SET lease_token=$2,lease_expires_at=$3,updated_at=$4
          WHERE id=$1 AND state IN ('claimed','reserved')`,
        [currentId, command.generationLeaseToken, command.generationLeaseExpiresAt, command.now],
      );
      await tenant.rows(
        `UPDATE practice_sessions SET generation_lease_token=$2,generation_lease_expires_at=$3,
          updated_at=$4 WHERE id=$1`,
        [
          command.sessionId,
          command.generationLeaseToken,
          command.generationLeaseExpiresAt,
          command.now,
        ],
      );
      return {
        claimed: true as const,
        generationId: currentId,
        leaseToken: command.generationLeaseToken,
        session: await loadPracticeSession(tenant, command.sessionId),
      };
    }
  }
  await tenant.rows(
    `INSERT INTO practice_generation_tasks(
      id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at
    ) VALUES($1,$2,$3,'dialogue-final-feedback','claimed',$4,$5,$6)`,
    [
      command.generationId,
      command.ownerUserId,
      command.sessionId,
      command.requestHash,
      command.generationLeaseToken,
      command.generationLeaseExpiresAt,
    ],
  );
  await tenant.rows(
    `UPDATE practice_sessions SET generation_lease_token=$2,generation_lease_expires_at=$3,
      current_generation_id=$4,updated_at=$5 WHERE id=$1`,
    [
      command.sessionId,
      command.generationLeaseToken,
      command.generationLeaseExpiresAt,
      command.generationId,
      command.now,
    ],
  );
  return {
    claimed: true as const,
    generationId: command.generationId,
    leaseToken: command.generationLeaseToken,
    session: await loadPracticeSession(tenant, command.sessionId),
  };
}

export function createPostgresDialogueFinishOperations(
  database: AnalysisDatabase,
): Pick<DialoguePracticeRepository, "beginFinish" | "completeFinish"> {
  return {
    async beginFinish(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await beginDialogueWrite(
          trusted,
          command.ownerUserId,
          "practice.dialogue-finish",
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay != null) {
          return { claimed: false, session: practiceSessionResponseSchema.parse(replay) };
        }
        const rows = await tenant.rows<{
          pending_generation: string | null;
          revision: number;
          status: string;
          type: string;
        }>(
          `SELECT type,status,pending_generation,revision FROM practice_sessions
            WHERE id=$1 FOR UPDATE`,
          [command.sessionId],
        );
        const row = rows[0];
        if (row?.type !== "dialogue") throw new CloudFault("not_found", "Dialogue not found.");
        if (row.revision !== command.expectedRevision) {
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        }
        if (row.status === "awaiting-feedback" && row.pending_generation === "final-feedback") {
          const claim = await claimPendingFinish(tenant, command);
          if (claim.claimed) {
            await saveDialogueWrite(trusted, command, "practice.dialogue-finish", claim.session);
          }
          return claim;
        }
        if (row.status !== "active") {
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        }
        const counts = await tenant.rows<{ rounds: number }>(
          `SELECT count(*)::int AS rounds FROM practice_turns
            WHERE session_id=$1 AND role='user'`,
          [command.sessionId],
        );
        const rounds = counts[0]?.rounds ?? 0;
        if (rounds < 3 || rounds > 5) {
          throw new CloudFault("invalid_request", "Dialogue requires three to five rounds.");
        }
        await tenant.rows(
          `INSERT INTO practice_generation_tasks(
            id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at
          ) VALUES($1,$2,$3,'dialogue-final-feedback','claimed',$4,$5,$6)`,
          [
            command.generationId,
            command.ownerUserId,
            command.sessionId,
            command.requestHash,
            command.generationLeaseToken,
            command.generationLeaseExpiresAt,
          ],
        );
        await tenant.rows(
          `UPDATE practice_sessions SET status='awaiting-feedback',pending_generation='final-feedback',
            generation_lease_token=$2,generation_lease_expires_at=$3,current_generation_id=$4,
            revision=revision+1,updated_at=$5 WHERE id=$1`,
          [
            command.sessionId,
            command.generationLeaseToken,
            command.generationLeaseExpiresAt,
            command.generationId,
            command.now,
          ],
        );
        const session = await loadPracticeSession(tenant, command.sessionId);
        await saveDialogueWrite(trusted, command, "practice.dialogue-finish", session);
        return {
          claimed: true,
          generationId: command.generationId,
          leaseToken: command.generationLeaseToken,
          session,
        };
      });
    },
    async completeFinish(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const tasks = await tenant.rows<{ output: unknown }>(
          `SELECT output FROM practice_generation_tasks WHERE id=$1 AND session_id=$2
            AND lease_token=$3 AND kind='dialogue-final-feedback' AND state='ready' FOR UPDATE`,
          [command.generationId, command.sessionId, command.generationLeaseToken],
        );
        if (tasks[0] === undefined) {
          throw new CloudFault("revision_conflict", "Dialogue generation lease changed.");
        }
        const output = practiceGenerationOutputSchema.parse(tasks[0]?.output);
        const session = await loadPracticeSession(tenant, command.sessionId);
        const mapped =
          output.kind === "dialogue-final-feedback"
            ? output.itemFeedbacks.map(({ feedback, itemAlias }) => ({
                feedback,
                itemId: session.items[Number(itemAlias.slice(5)) - 1]?.itemId,
              }))
            : [];
        if (
          output.kind !== "dialogue-final-feedback" ||
          output.summary !== command.finalFeedback ||
          mapped.some((item) => item.itemId === undefined) ||
          JSON.stringify(mapped) !== JSON.stringify(command.itemFeedbacks)
        ) {
          throw new CloudFault("revision_conflict", "Dialogue generation changed.");
        }
        const updated = await tenant.rows<{ id: string }>(
          `UPDATE practice_sessions SET status='completed',completed_at=COALESCE(completed_at,$6),
            pending_generation=NULL,generation_lease_token=NULL,generation_lease_expires_at=NULL,
            current_generation_id=NULL,final_feedback=$4,item_feedbacks=$5::jsonb,
            revision=revision+1,updated_at=$6 WHERE id=$1 AND generation_lease_token=$2
            AND current_generation_id=$3 AND pending_generation='final-feedback' RETURNING id::text`,
          [
            command.sessionId,
            command.generationLeaseToken,
            command.generationId,
            command.finalFeedback,
            JSON.stringify(command.itemFeedbacks),
            command.now,
          ],
        );
        if (updated[0] === undefined) {
          throw new CloudFault("revision_conflict", "Dialogue generation lease changed.");
        }
        await tenant.rows(
          "UPDATE practice_generation_tasks SET state='applied',output=NULL,updated_at=$2 WHERE id=$1",
          [command.generationId, command.now],
        );
        const response = await loadPracticeSession(tenant, command.sessionId);
        await replaceDialogueWrite(
          trusted,
          command.ownerUserId,
          "practice.dialogue-finish",
          command.idempotencyKey,
          response,
        );
        return response;
      });
    },
  };
}
