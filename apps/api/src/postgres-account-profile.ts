import { accountResourceSchema, type AccountResource } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AccountProfileModule } from "./account-profile-app.js";
import { CloudFault } from "./cloud-fault.js";

interface ProfileRow {
  cloud_word_copy_mode: "disabled" | "enabled";
  daily_goal: number;
  email: string;
  extension_query_model_mode: "byok" | "platform";
  preferences_revision: number;
  study_capture_mode: "automatic" | "manual";
  timezone: string;
  updated_at: Date;
}

interface SessionRow {
  created_at: Date;
  device_label: string;
  expires_at: Date;
  id: string;
  last_used_at: Date | null;
}

export function createPostgresAccountProfile(options: {
  database: AnalysisDatabase;
  minSupportedExtensionVersion: string;
}): AccountProfileModule {
  return {
    async read(ownerUserId): Promise<AccountResource> {
      if (options.database.snapshot === undefined) {
        throw new TypeError("Account profile requires repeatable-read snapshot support.");
      }
      return options.database.snapshot(ownerUserId, async ({ tenant }) => {
        const profile = (
          await tenant.rows<ProfileRow>(
            `SELECT email,timezone,daily_goal,extension_query_model_mode,study_capture_mode,
               cloud_word_copy_mode,preferences_revision,updated_at
             FROM user_profiles WHERE user_id=$1 AND status='active'`,
            [ownerUserId],
          )
        )[0];
        if (profile === undefined) throw new CloudFault("not_found", "Account not found.");
        const sessions = await tenant.rows<SessionRow>(
          `SELECT id::text,device_label,created_at,last_used_at,expires_at
             FROM extension_sessions
             WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
             ORDER BY created_at,id LIMIT 101`,
          [ownerUserId],
        );
        return accountResourceSchema.parse({
          email: profile.email,
          extensionSessions: sessions.map((session) => ({
            createdAt: session.created_at.toISOString(),
            deviceLabel: session.device_label,
            expiresAt: session.expires_at.toISOString(),
            id: session.id,
            lastUsedAt: session.last_used_at?.toISOString() ?? null,
          })),
          minSupportedExtensionVersion: options.minSupportedExtensionVersion,
          preferences: {
            cloudWordCopyMode: profile.cloud_word_copy_mode,
            dailyGoal: profile.daily_goal,
            extensionQueryModelMode: profile.extension_query_model_mode,
            revision: profile.preferences_revision,
            studyCaptureMode: profile.study_capture_mode,
            timezone: profile.timezone,
            updatedAt: profile.updated_at.toISOString(),
          },
        });
      });
    },
  };
}
