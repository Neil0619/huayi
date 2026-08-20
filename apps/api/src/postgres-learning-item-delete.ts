import { deleteLearningItemResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { LearningLibraryMaintenanceRepository } from "./learning-library-maintenance.js";

type DeleteLearningItem = LearningLibraryMaintenanceRepository["delete"];

function translate(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}

export function createPostgresLearningItemDelete(database: AnalysisDatabase): DeleteLearningItem {
  return async (command) => {
    try {
      return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await trusted.rows<{ response: unknown }>(
          "SELECT begin_idempotent_write($1,'learning.delete',$2,$3) AS response",
          [command.ownerUserId, command.idempotencyKey, command.requestHash],
        );
        if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
          return deleteLearningItemResponseSchema.parse(replay[0].response);
        }
        const items = await tenant.rows<{ archived_at: Date | null; revision: number }>(
          `SELECT archived_at,revision FROM learning_items
            WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
          [command.id],
        );
        const item = items[0];
        if (item === undefined) throw new CloudFault("not_found", "Learning item not found.");
        if (item.revision !== command.expectedRevision) {
          throw new CloudFault("revision_conflict", "Learning item changed.");
        }
        const references = await tenant.rows<{
          feedback_lease: boolean;
          generation_lease_token: string | null;
          pending_generation: string | null;
          rating: string | null;
          status: string;
        }>(
          `SELECT sessions.status,sessions.pending_generation,
            sessions.generation_lease_token,links.rating,
            EXISTS(SELECT 1 FROM practice_attempts attempts
              WHERE attempts.session_id=sessions.id
              AND attempts.feedback_lease_token IS NOT NULL) feedback_lease
            FROM practice_session_items links
            JOIN practice_sessions sessions ON sessions.id=links.session_id
            WHERE links.learning_item_id=$1 ORDER BY sessions.id FOR UPDATE OF sessions`,
          [command.id],
        );
        if (
          references.some(
            (reference) =>
              reference.pending_generation !== null ||
              reference.generation_lease_token !== null ||
              reference.feedback_lease ||
              (reference.status !== "failed" &&
                (reference.status !== "completed" || reference.rating === null)),
          )
        ) {
          throw new CloudFault("learning_item_in_use", "This learning item cannot be removed.");
        }
        const deletionKind = references.length === 0 ? "hard-delete" : "erased";
        if (deletionKind === "erased" && item.archived_at === null) {
          throw new CloudFault(
            "learning_item_must_be_archived",
            "Archive the learning item before permanent deletion.",
          );
        }
        const response = deleteLearningItemResponseSchema.parse({
          deleted: true,
          deletionKind,
          id: command.id,
        });
        if (deletionKind === "hard-delete") {
          await tenant.rows("DELETE FROM learning_items WHERE id=$1", [command.id]);
        } else {
          await tenant.rows("DELETE FROM source_examples WHERE learning_item_id=$1", [command.id]);
          await tenant.rows("DELETE FROM learning_item_tags WHERE learning_item_id=$1", [
            command.id,
          ]);
          await tenant.rows("DELETE FROM schedule_states WHERE learning_item_id=$1", [command.id]);
          await tenant.rows(
            `UPDATE learning_items SET type=NULL,canonical_key=NULL,content=NULL,
              system_attributes='[]'::jsonb,archived_at=NULL,deleted_at=$2::timestamptz,
              revision=revision+1,updated_at=$2::timestamptz WHERE id=$1`,
            [command.id, command.now],
          );
        }
        const expiresAt = new Date(
          Date.parse(command.now) + 7 * 24 * 60 * 60 * 1_000,
        ).toISOString();
        await trusted.rows(
          `INSERT INTO idempotency_records(
            owner_user_id,operation,key,request_hash,response,expires_at
          ) VALUES($1,'learning.delete',$2,$3,$4::jsonb,$5::timestamptz)`,
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
    } catch (error) {
      return translate(error);
    }
  };
}
