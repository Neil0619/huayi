import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { DialoguePracticeRepository } from "./dialogue-practice-module.js";
import { practiceGenerationOutputSchema } from "./paid-practice-generator.js";
import {
  beginDialogueWrite,
  replaceDialogueWrite,
  requireDialogueState,
  saveDialogueWrite,
} from "./postgres-dialogue-practice-support.js";
import { loadPracticeSession } from "./postgres-practice-view.js";

type AssistantOperations = Pick<
  DialoguePracticeRepository,
  "beginAssistantRetry" | "completeAssistant" | "recordUserTurn"
>;

async function claimPendingAssistant(
  tenant: AnalysisQuery,
  command: Parameters<DialoguePracticeRepository["beginAssistantRetry"]>[0],
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
    ) VALUES($1,$2,$3,'dialogue-assistant','claimed',$4,$5,$6)`,
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

export function createPostgresDialogueAssistantOperations(
  database: AnalysisDatabase,
): AssistantOperations {
  return {
    async beginAssistantRetry(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await beginDialogueWrite(
          trusted,
          command.ownerUserId,
          "practice.dialogue-assistant-retry",
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay != null) {
          return { claimed: false, session: practiceSessionResponseSchema.parse(replay) };
        }
        const row = await requireDialogueState(
          tenant,
          command.sessionId,
          "awaiting-feedback",
          command.expectedRevision,
        );
        if (row.pending_generation !== "assistant-turn") {
          throw new CloudFault("revision_conflict", "Assistant turn is not pending.");
        }
        return claimPendingAssistant(tenant, command);
      });
    },
    async completeAssistant(command) {
      return database.transaction(command.ownerUserId, async ({ tenant }) => {
        const tasks = await tenant.rows<{ output: unknown }>(
          `SELECT output FROM practice_generation_tasks WHERE id=$1 AND session_id=$2
            AND lease_token=$3 AND kind='dialogue-assistant' AND state='ready' FOR UPDATE`,
          [command.generationId, command.sessionId, command.generationLeaseToken],
        );
        if (tasks[0] === undefined) {
          throw new CloudFault("revision_conflict", "Dialogue generation lease changed.");
        }
        const output = practiceGenerationOutputSchema.parse(tasks[0]?.output);
        if (
          output.kind !== "dialogue-assistant" ||
          output.assistantTurn !== command.assistantTurn
        ) {
          throw new CloudFault("revision_conflict", "Dialogue generation changed.");
        }
        const sessions = await tenant.rows<{ revision: number }>(
          `UPDATE practice_sessions SET status='active',pending_generation=NULL,
            generation_lease_token=NULL,generation_lease_expires_at=NULL,current_generation_id=NULL,
            revision=revision+1,updated_at=$4 WHERE id=$1 AND status='awaiting-feedback'
            AND pending_generation='assistant-turn' AND generation_lease_token=$2
            AND current_generation_id=$3 RETURNING revision`,
          [command.sessionId, command.generationLeaseToken, command.generationId, command.now],
        );
        if (sessions[0] === undefined) {
          throw new CloudFault("revision_conflict", "Dialogue generation lease changed.");
        }
        const ordinals = await tenant.rows<{ ordinal: number }>(
          "SELECT COALESCE(max(ordinal),-1)+1 AS ordinal FROM practice_turns WHERE session_id=$1",
          [command.sessionId],
        );
        await tenant.rows(
          `INSERT INTO practice_turns(id,session_id,owner_user_id,ordinal,role,content,created_at)
            VALUES($1,$2,$3,$4,'assistant',$5,$6)`,
          [
            command.turnId,
            command.sessionId,
            command.ownerUserId,
            ordinals[0]?.ordinal ?? 0,
            command.assistantTurn,
            command.now,
          ],
        );
        await tenant.rows(
          "UPDATE practice_generation_tasks SET state='applied',output=NULL,updated_at=$2 WHERE id=$1",
          [command.generationId, command.now],
        );
        const response = await loadPracticeSession(tenant, command.sessionId);
        if (command.operation === "practice.dialogue-assistant-retry") {
          await saveDialogueWrite(tenant, command, command.operation, response);
        } else {
          await replaceDialogueWrite(
            tenant,
            command.ownerUserId,
            command.operation,
            command.idempotencyKey,
            response,
          );
        }
        return response;
      });
    },
    async recordUserTurn(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await beginDialogueWrite(
          trusted,
          command.ownerUserId,
          "practice.dialogue-turn",
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay != null) {
          return { claimed: false, session: practiceSessionResponseSchema.parse(replay) };
        }
        await requireDialogueState(tenant, command.sessionId, "active", command.expectedRevision);
        const ordinals = await tenant.rows<{ ordinal: number; rounds: number }>(
          `SELECT COALESCE(max(ordinal),-1)+1 AS ordinal,
            count(*) FILTER (WHERE role='user')::int AS rounds
            FROM practice_turns WHERE session_id=$1`,
          [command.sessionId],
        );
        if ((ordinals[0]?.rounds ?? 0) >= 5) {
          throw new CloudFault("invalid_request", "Dialogue has reached five rounds.");
        }
        await tenant.rows(
          `INSERT INTO practice_turns(id,session_id,owner_user_id,ordinal,role,content,created_at)
            VALUES($1,$2,$3,$4,'user',$5,$6)`,
          [
            command.turnId,
            command.sessionId,
            command.ownerUserId,
            ordinals[0]?.ordinal ?? 0,
            command.content,
            command.now,
          ],
        );
        await tenant.rows(
          `INSERT INTO practice_generation_tasks(
            id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at
          ) VALUES($1,$2,$3,'dialogue-assistant','claimed',$4,$5,$6)`,
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
          `UPDATE practice_sessions SET status='awaiting-feedback',pending_generation='assistant-turn',
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
        await saveDialogueWrite(tenant, command, "practice.dialogue-turn", session);
        return {
          claimed: true,
          generationId: command.generationId,
          leaseToken: command.generationLeaseToken,
          session,
        };
      });
    },
  };
}
