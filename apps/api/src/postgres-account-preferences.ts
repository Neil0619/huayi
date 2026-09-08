import { accountPreferencesResponseSchema, type AccountPreferences } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AccountPreferencesRepository } from "./account-preferences-app.js";
import { accountLearningTimezone } from "./account-learning-timezone.js";
import { CloudFault } from "./cloud-fault.js";

interface PreferencesRow {
  cloud_word_copy_mode: "disabled" | "enabled";
  daily_goal: number;
  extension_query_model_mode: "byok" | "platform";
  preferences_revision: number;
  study_capture_mode: "automatic" | "manual";
  updated_at: Date;
}

const projection = `daily_goal,extension_query_model_mode,study_capture_mode,
  cloud_word_copy_mode,preferences_revision,updated_at`;

function project(row: PreferencesRow | undefined): AccountPreferences {
  if (row === undefined) throw new CloudFault("not_found", "Account preferences not found.");
  return accountPreferencesResponseSchema.parse({
    cloudWordCopyMode: row.cloud_word_copy_mode,
    dailyGoal: row.daily_goal,
    extensionQueryModelMode: row.extension_query_model_mode,
    revision: row.preferences_revision,
    studyCaptureMode: row.study_capture_mode,
    timezone: accountLearningTimezone,
    updatedAt: row.updated_at.toISOString(),
  });
}

export function createPostgresAccountPreferences(
  database: AnalysisDatabase,
): AccountPreferencesRepository {
  return {
    async read(ownerUserId) {
      return database.transaction(ownerUserId, async ({ tenant }) =>
        project(
          (
            await tenant.rows<PreferencesRow>(
              `SELECT ${projection} FROM user_profiles WHERE user_id=$1`,
              [ownerUserId],
            )
          )[0],
        ),
      );
    },
    async update(ownerUserId, preferences) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const row = (
          await tenant.rows<PreferencesRow>(
            `UPDATE user_profiles SET
                 timezone=$2, daily_goal=COALESCE($3,daily_goal),
                 extension_query_model_mode=COALESCE($4,extension_query_model_mode),
                 study_capture_mode=COALESCE($5,study_capture_mode),
                 cloud_word_copy_mode=COALESCE($6,cloud_word_copy_mode),
                 preferences_revision=preferences_revision+1, updated_at=now()
               WHERE user_id=$1 AND preferences_revision=$7 RETURNING ${projection}`,
            [
              ownerUserId,
              accountLearningTimezone,
              preferences.dailyGoal ?? null,
              preferences.extensionQueryModelMode ?? null,
              preferences.studyCaptureMode ?? null,
              preferences.cloudWordCopyMode ?? null,
              preferences.expectedRevision,
            ],
          )
        )[0];
        if (row === undefined) {
          throw new CloudFault("revision_conflict", "The preferences revision has changed.");
        }
        return project(row);
      });
    },
  };
}
