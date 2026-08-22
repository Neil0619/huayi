import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { practiceGenerationOutputSchema } from "./paid-practice-generator.js";
import type { DialoguePracticeRepository } from "./dialogue-practice-module.js";
import { beginDialogueWrite } from "./postgres-dialogue-practice-support.js";
import {
  loadPracticeSession,
  requireActivePracticeItem,
  requireActiveProfile,
} from "./postgres-practice-view.js";

type StartCommand = Parameters<DialoguePracticeRepository["reserveStart"]>[0];

export async function reserveDialogueStart(database: AnalysisDatabase, command: StartCommand) {
  return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
    const replay = await beginDialogueWrite(
      trusted,
      command.ownerUserId,
      "practice.dialogue-start",
      command.idempotencyKey,
      command.requestHash,
    );
    if (replay != null) {
      return { claimed: false as const, session: practiceSessionResponseSchema.parse(replay) };
    }
    await requireActiveProfile(tenant, command.ownerUserId);
    const active = await tenant.rows<{
      current_generation_id: string | null;
      id: string;
      pending_generation: string | null;
      type: string;
    }>(
      `SELECT id::text,type,pending_generation,current_generation_id::text FROM practice_sessions
        WHERE status IN ('active','awaiting-feedback') OR
        (status='completed' AND EXISTS (SELECT 1 FROM practice_session_items links
          WHERE links.session_id=practice_sessions.id AND links.rating IS NULL)) LIMIT 1
        FOR UPDATE`,
    );
    const current = active[0];
    if (current?.type === "dialogue" && current.pending_generation === "dialogue-start") {
      const linked = await tenant.rows<{ learning_item_id: string }>(
        `SELECT learning_item_id::text FROM practice_session_items
          WHERE session_id=$1 ORDER BY position`,
        [current.id],
      );
      if (
        linked.length !== command.itemIds.length ||
        linked.some((item, index) => item.learning_item_id !== command.itemIds[index])
      ) {
        throw new CloudFault("generation_busy", "Different dialogue generation is pending.");
      }
      if (current.current_generation_id !== null) {
        const tasks = await tenant.rows<{
          lease_expires_at: Date;
          lease_token: string;
          state: string;
        }>(
          `SELECT state,lease_token,lease_expires_at FROM practice_generation_tasks
            WHERE id=$1 FOR UPDATE`,
          [current.current_generation_id],
        );
        const task = tasks[0];
        const session = await loadPracticeSession(tenant, current.id);
        if (task?.state === "ready") {
          return {
            claimed: true as const,
            generationId: current.current_generation_id,
            leaseToken: task.lease_token,
            session,
          };
        }
        if (task?.state === "dispatched") {
          return task.lease_expires_at.getTime() > Date.parse(command.now)
            ? { claimed: false as const, session }
            : {
                claimed: true as const,
                generationId: current.current_generation_id,
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
            [
              current.current_generation_id,
              command.generationLeaseToken,
              command.generationLeaseExpiresAt,
              command.now,
            ],
          );
          await tenant.rows(
            `UPDATE practice_sessions SET generation_lease_token=$2,
              generation_lease_expires_at=$3,updated_at=$4 WHERE id=$1`,
            [
              current.id,
              command.generationLeaseToken,
              command.generationLeaseExpiresAt,
              command.now,
            ],
          );
          return {
            claimed: true as const,
            generationId: current.current_generation_id,
            leaseToken: command.generationLeaseToken,
            session: await loadPracticeSession(tenant, current.id),
          };
        }
      }
      await tenant.rows(
        `INSERT INTO practice_generation_tasks(
          id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at
        ) VALUES($1,$2,$3,'dialogue-start','claimed',$4,$5,$6)`,
        [
          command.generationId,
          command.ownerUserId,
          current.id,
          command.requestHash,
          command.generationLeaseToken,
          command.generationLeaseExpiresAt,
        ],
      );
      await tenant.rows(
        `UPDATE practice_sessions SET generation_lease_token=$2,generation_lease_expires_at=$3,
          current_generation_id=$4,updated_at=$5 WHERE id=$1`,
        [
          current.id,
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
        session: await loadPracticeSession(tenant, current.id),
      };
    }
    if (current !== undefined) throw new CloudFault("generation_busy", "Practice active.");
    const lockedItems = new Map<string, Awaited<ReturnType<typeof requireActivePracticeItem>>>();
    for (const itemId of [...new Set(command.itemIds)].sort()) {
      lockedItems.set(itemId, await requireActivePracticeItem(tenant, itemId, { lock: true }));
    }
    const items = command.itemIds.map((itemId) => lockedItems.get(itemId));
    await tenant.rows(
      `INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt,pending_generation,
        generation_lease_token,generation_lease_expires_at,created_at,updated_at)
        VALUES($1,$2,'dialogue','awaiting-feedback',NULL,
          'dialogue-start',$3,$4,$5,$5)`,
      [
        command.sessionId,
        command.ownerUserId,
        command.generationLeaseToken,
        command.generationLeaseExpiresAt,
        command.now,
      ],
    );
    for (const [position, item] of items.entries()) {
      if (item === undefined) throw new CloudFault("not_found", "Learning item not found.");
      await tenant.rows(
        `INSERT INTO practice_session_items(session_id,learning_item_id,owner_user_id,
          position,schedule_before) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [
          command.sessionId,
          item.item.id,
          command.ownerUserId,
          position,
          JSON.stringify(item.schedule),
        ],
      );
    }
    await tenant.rows(
      `INSERT INTO practice_generation_tasks(
        id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at
      ) VALUES($1,$2,$3,'dialogue-start','claimed',$4,$5,$6)`,
      [
        command.generationId,
        command.ownerUserId,
        command.sessionId,
        command.requestHash,
        command.generationLeaseToken,
        command.generationLeaseExpiresAt,
      ],
    );
    await tenant.rows("UPDATE practice_sessions SET current_generation_id=$2 WHERE id=$1", [
      command.sessionId,
      command.generationId,
    ]);
    return {
      claimed: true as const,
      generationId: command.generationId,
      leaseToken: command.generationLeaseToken,
      session: await loadPracticeSession(tenant, command.sessionId),
    };
  });
}

export async function completeDialogueStart(
  database: AnalysisDatabase,
  command: Parameters<DialoguePracticeRepository["completeStart"]>[0],
) {
  return database.transaction(command.ownerUserId, async ({ tenant }) => {
    const tasks = await tenant.rows<{ output: unknown }>(
      `SELECT output FROM practice_generation_tasks WHERE id=$1 AND session_id=$2
        AND lease_token=$3 AND kind='dialogue-start' AND state='ready' FOR UPDATE`,
      [command.generationId, command.sessionId, command.generationLeaseToken],
    );
    if (tasks[0] === undefined) {
      throw new CloudFault("revision_conflict", "Dialogue generation lease changed.");
    }
    const output = practiceGenerationOutputSchema.parse(tasks[0]?.output);
    if (
      output.kind !== "dialogue-start" ||
      output.opener !== command.opener ||
      output.prompt !== command.prompt ||
      JSON.stringify(output.plan) !== JSON.stringify(command.plan)
    ) {
      throw new CloudFault("revision_conflict", "Dialogue generation changed.");
    }
    const updated = await tenant.rows<{ id: string }>(
      `UPDATE practice_sessions SET status='active',prompt=$4,dialogue_plan=$5::jsonb,
        pending_generation=NULL,generation_lease_token=NULL,generation_lease_expires_at=NULL,
        current_generation_id=NULL,updated_at=$6 WHERE id=$1 AND generation_lease_token=$2
        AND current_generation_id=$3 AND pending_generation='dialogue-start' RETURNING id::text`,
      [
        command.sessionId,
        command.generationLeaseToken,
        command.generationId,
        command.prompt,
        JSON.stringify(command.plan),
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
    await tenant.rows(
      `INSERT INTO practice_turns(id,session_id,owner_user_id,ordinal,role,content,created_at)
        VALUES($1,$2,$3,0,'assistant',$4,$5)`,
      [command.openerTurnId, command.sessionId, command.ownerUserId, command.opener, command.now],
    );
    const response = await loadPracticeSession(tenant, command.sessionId);
    const expiresAt = new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString();
    await tenant.rows(
      `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
        VALUES($1,'practice.dialogue-start',$2,$3,$4::jsonb,$5)`,
      [
        command.ownerUserId,
        command.idempotencyKey,
        command.requestHash,
        JSON.stringify(response),
        expiresAt,
      ],
    );
    return response;
  });
}
