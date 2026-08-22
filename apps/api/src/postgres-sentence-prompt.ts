import { practiceSessionResponseSchema, type PracticeSession } from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeRepository } from "./practice-module.js";
import {
  findPracticeItem,
  loadPracticeSession,
  requireActiveProfile,
  requireActivePracticeItem,
} from "./postgres-practice-view.js";

type BeginCommand = Parameters<PracticeRepository["beginSentence"]>[0];
type CompleteCommand = Parameters<PracticeRepository["completeSentencePrompt"]>[0];
type ReleaseCommand = Parameters<PracticeRepository["releaseSentencePromptLease"]>[0];

async function begin(trusted: AnalysisQuery, command: BeginCommand) {
  const rows = await trusted.rows<{ response: unknown }>(
    "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
    [command.ownerUserId, "practice.start", command.idempotencyKey, command.requestHash],
  );
  return rows[0]?.response;
}

async function savePending(
  tenant: AnalysisQuery,
  command: BeginCommand,
  response: PracticeSession,
) {
  const expiresAt = new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString();
  await tenant.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
      VALUES($1,'practice.start',$2,$3,$4::jsonb,$5::timestamptz)`,
    [
      command.ownerUserId,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(response),
      expiresAt,
    ],
  );
}

export function createPostgresSentencePromptOperations(
  database: AnalysisDatabase,
): Pick<
  PracticeRepository,
  "beginSentence" | "completeSentencePrompt" | "releaseSentencePromptLease"
> {
  return {
    async beginSentence(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await begin(trusted, command);
        if (replay !== null && replay !== undefined) {
          const session = practiceSessionResponseSchema.parse(replay);
          return { claimed: false, session };
        }
        await requireActiveProfile(tenant, command.ownerUserId);
        const requestedItem = await findPracticeItem(tenant, command.itemId);
        if (requestedItem === null) throw new CloudFault("not_found", "Learning item not found.");
        const active = await tenant.rows<{
          generation_lease_expires_at: Date | null;
          id: string;
          item_id: string;
          current_generation_id: string | null;
          pending_generation: string | null;
          status: string;
          task_lease_expires_at: Date | null;
          task_lease_token: string | null;
          task_state: string | null;
          type: string;
        }>(
          `SELECT sessions.id::text,sessions.type,sessions.status,sessions.pending_generation,
            sessions.current_generation_id::text,
            sessions.generation_lease_expires_at,links.learning_item_id::text item_id,
            tasks.state task_state,tasks.lease_token task_lease_token,
            tasks.lease_expires_at task_lease_expires_at
            FROM practice_sessions sessions
            JOIN practice_session_items links ON links.session_id=sessions.id
            LEFT JOIN practice_generation_tasks tasks ON tasks.id=sessions.current_generation_id
            WHERE sessions.status IN ('active','awaiting-feedback') OR
              (sessions.status='completed' AND EXISTS (
                SELECT 1 FROM practice_session_items unrated
                WHERE unrated.session_id=sessions.id AND unrated.rating IS NULL
              ))
            ORDER BY sessions.created_at,sessions.id LIMIT 1 FOR UPDATE OF sessions`,
        );
        const current = active[0];
        if (current !== undefined) {
          if (
            current.type !== "sentence-creation" ||
            current.status !== "awaiting-feedback" ||
            current.pending_generation !== "sentence-prompt" ||
            current.item_id !== command.itemId
          ) {
            throw new CloudFault("generation_busy", "Practice session active.");
          }
          const session = await loadPracticeSession(tenant, current.id);
          if (
            current.current_generation_id !== null &&
            current.task_state === "ready" &&
            current.task_lease_token !== null
          ) {
            await savePending(tenant, command, session);
            return {
              claimed: true,
              generationId: current.current_generation_id,
              item: requestedItem,
              leaseToken: current.task_lease_token,
              session,
            };
          }
          if (
            current.current_generation_id !== null &&
            current.task_state === "dispatched" &&
            current.task_lease_token !== null
          ) {
            await savePending(tenant, command, session);
            return current.task_lease_expires_at !== null &&
              current.task_lease_expires_at.getTime() <= Date.parse(command.now)
              ? {
                  claimed: true,
                  generationId: current.current_generation_id,
                  item: requestedItem,
                  leaseToken: current.task_lease_token,
                  session,
                }
              : { claimed: false, item: requestedItem, session };
          }
          if (
            ["claimed", "reserved"].includes(current.task_state ?? "") &&
            current.generation_lease_expires_at !== null &&
            current.generation_lease_expires_at.getTime() > Date.parse(command.now)
          ) {
            await savePending(tenant, command, session);
            return { claimed: false, item: requestedItem, session };
          }
          let generationId = current.current_generation_id;
          if (["claimed", "reserved"].includes(current.task_state ?? "")) {
            if (generationId === null) {
              throw new CloudFault("revision_conflict", "Practice generation is missing.");
            }
            await tenant.rows(
              `UPDATE practice_generation_tasks SET lease_token=$2,lease_expires_at=$3,
                updated_at=$4 WHERE id=$1 AND state IN ('claimed','reserved')`,
              [
                generationId,
                command.generationLeaseToken,
                command.generationLeaseExpiresAt,
                command.now,
              ],
            );
          } else {
            await tenant.rows(
              `INSERT INTO practice_generation_tasks(
                id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at,
                created_at,updated_at
              ) VALUES($1,$2,$3,'sentence-prompt','claimed',$4,$5,$6,$7,$7)`,
              [
                command.generationId,
                command.ownerUserId,
                current.id,
                command.requestHash,
                command.generationLeaseToken,
                command.generationLeaseExpiresAt,
                command.now,
              ],
            );
            generationId = command.generationId;
          }
          await tenant.rows(
            `UPDATE practice_sessions SET generation_lease_token=$2,
              generation_lease_expires_at=$3,current_generation_id=$4,updated_at=$5 WHERE id=$1`,
            [
              current.id,
              command.generationLeaseToken,
              command.generationLeaseExpiresAt,
              generationId,
              command.now,
            ],
          );
          const claimed = await loadPracticeSession(tenant, current.id);
          await savePending(tenant, command, claimed);
          return {
            claimed: true,
            generationId,
            item: requestedItem,
            leaseToken: command.generationLeaseToken,
            session: claimed,
          };
        }
        const activeRequestedItem = await requireActivePracticeItem(tenant, command.itemId, {
          lock: true,
        });
        await tenant.rows(
          `INSERT INTO practice_sessions(
            id,owner_user_id,type,status,prompt,pending_generation,
            generation_lease_token,generation_lease_expires_at,created_at,updated_at
          ) VALUES($1,$2,'sentence-creation','awaiting-feedback',NULL,'sentence-prompt',$3,$4,$5,$5)`,
          [
            command.sessionId,
            command.ownerUserId,
            command.generationLeaseToken,
            command.generationLeaseExpiresAt,
            command.now,
          ],
        );
        await tenant.rows(
          `INSERT INTO practice_session_items(
            session_id,learning_item_id,owner_user_id,position,schedule_before
          ) VALUES($1,$2,$3,0,$4::jsonb)`,
          [
            command.sessionId,
            command.itemId,
            command.ownerUserId,
            JSON.stringify(activeRequestedItem.schedule),
          ],
        );
        await tenant.rows(
          `INSERT INTO practice_generation_tasks(
            id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at,
            created_at,updated_at
          ) VALUES($1,$2,$3,'sentence-prompt','claimed',$4,$5,$6,$7,$7)`,
          [
            command.generationId,
            command.ownerUserId,
            command.sessionId,
            command.requestHash,
            command.generationLeaseToken,
            command.generationLeaseExpiresAt,
            command.now,
          ],
        );
        await tenant.rows("UPDATE practice_sessions SET current_generation_id=$2 WHERE id=$1", [
          command.sessionId,
          command.generationId,
        ]);
        const session = await loadPracticeSession(tenant, command.sessionId);
        await savePending(tenant, command, session);
        return {
          claimed: true,
          generationId: command.generationId,
          item: activeRequestedItem,
          leaseToken: command.generationLeaseToken,
          session,
        };
      });
    },
    async completeSentencePrompt(command: CompleteCommand) {
      return database.transaction(command.ownerUserId, async ({ tenant }) => {
        const applied = await tenant.rows<{ id: string }>(
          `UPDATE practice_generation_tasks SET state='applied',output=NULL,updated_at=$3
            WHERE session_id=$1 AND owner_user_id=$2 AND lease_token=$4 AND state='ready'
            RETURNING id::text`,
          [command.sessionId, command.ownerUserId, command.now, command.generationLeaseToken],
        );
        const generationId = applied[0]?.id;
        const updated =
          generationId === undefined
            ? []
            : await tenant.rows<{ id: string }>(
                `UPDATE practice_sessions SET status='active',prompt=$3,pending_generation=NULL,
            generation_lease_token=NULL,generation_lease_expires_at=NULL,
            current_generation_id=NULL,revision=revision+1,updated_at=$4
            WHERE id=$1 AND owner_user_id=$2 AND status='awaiting-feedback'
            AND pending_generation='sentence-prompt' AND generation_lease_token=$5
            AND current_generation_id=$6
            RETURNING id::text`,
                [
                  command.sessionId,
                  command.ownerUserId,
                  command.prompt,
                  command.now,
                  command.generationLeaseToken,
                  generationId,
                ],
              );
        const session = await loadPracticeSession(tenant, command.sessionId);
        if (updated[0] === undefined && session.prompt !== command.prompt) {
          throw new CloudFault("revision_conflict", "Practice prompt generation changed.");
        }
        await tenant.rows(
          `UPDATE idempotency_records SET response=$5::jsonb
            WHERE owner_user_id=$1 AND operation='practice.start' AND key=$2 AND request_hash=$3
            AND expires_at>$4`,
          [
            command.ownerUserId,
            command.idempotencyKey,
            command.requestHash,
            command.now,
            JSON.stringify(session),
          ],
        );
        return session;
      });
    },
    async releaseSentencePromptLease(command: ReleaseCommand) {
      await database.transaction(command.ownerUserId, async ({ tenant }) => {
        await tenant.rows(
          `UPDATE practice_sessions SET generation_lease_token=NULL,
            generation_lease_expires_at=NULL,current_generation_id=NULL,updated_at=$4
            WHERE id=$1 AND owner_user_id=$2 AND pending_generation='sentence-prompt'
            AND generation_lease_token=$3`,
          [command.sessionId, command.ownerUserId, command.generationLeaseToken, command.now],
        );
        await tenant.rows(
          `UPDATE practice_generation_tasks SET state='failed',stable_error_code='model_unavailable',
            updated_at=$4 WHERE session_id=$1 AND owner_user_id=$2 AND lease_token=$3
            AND state IN ('claimed','reserved')`,
          [command.sessionId, command.ownerUserId, command.generationLeaseToken, command.now],
        );
      });
    },
  };
}
