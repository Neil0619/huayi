import type { AnalysisDatabase } from "./analysis-database.js";
import type { DialoguePracticeRepository } from "./dialogue-practice-module.js";
import { createPostgresDialogueAssistantOperations } from "./postgres-dialogue-assistant.js";
import { createPostgresDialogueFinishOperations } from "./postgres-dialogue-finish.js";
import { completeDialogueStart, reserveDialogueStart } from "./postgres-dialogue-start.js";
import { requireActivePracticeItem, requireActiveProfile } from "./postgres-practice-view.js";

export function createPostgresDialoguePracticeRepository(
  database: AnalysisDatabase,
): DialoguePracticeRepository {
  return {
    ...createPostgresDialogueAssistantOperations(database),
    ...createPostgresDialogueFinishOperations(database),
    async completeStart(command) {
      return completeDialogueStart(database, command);
    },
    async findItems(ownerUserId, itemIds) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        await requireActiveProfile(tenant, ownerUserId);
        return Promise.all(itemIds.map((itemId) => requireActivePracticeItem(tenant, itemId)));
      });
    },
    async releaseGenerationLease(command) {
      await database.transaction(command.ownerUserId, ({ tenant }) =>
        tenant.rows(
          `UPDATE practice_sessions SET generation_lease_token=NULL,
            generation_lease_expires_at=NULL,updated_at=$3 WHERE id=$1
            AND generation_lease_token=$2`,
          [command.sessionId, command.generationLeaseToken, command.now],
        ),
      );
    },
    async reserveStart(command) {
      return reserveDialogueStart(database, command);
    },
  };
}
