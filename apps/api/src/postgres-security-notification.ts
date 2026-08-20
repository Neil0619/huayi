import { accountEmailSchema, resourceIdSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { hashSecret, opaqueSecret, type Clock, type SecretSource } from "./security.js";
import type { SecurityNotificationRepository } from "./security-notification-worker.js";

function requireSaved(value: boolean | null | undefined): void {
  if (value !== true) throw new Error("Security notification lease is stale.");
}

export function createPostgresSecurityNotificationRepository(
  database: AnalysisDatabase,
  options: { clock: Clock; pepper: string; secrets: SecretSource },
): SecurityNotificationRepository {
  return {
    async claim() {
      const leaseToken = opaqueSecret(options.secrets);
      const now = options.clock.now();
      const leaseExpiresAt = new Date(now.getTime() + 120_000);
      const row = await database.trusted(
        async (query) =>
          (
            await query.rows<{
              attempt_count: number;
              email: string;
              notification_id: string;
            }>(
              `SELECT notification_id::text,email,attempt_count
             FROM claim_security_notification($1,$2,$3)`,
              [hashSecret(leaseToken, options.pepper), leaseExpiresAt, now],
            )
          )[0],
      );
      if (row === undefined) return null;
      if (!Number.isInteger(row.attempt_count) || row.attempt_count < 1) {
        throw new Error("Security notification attempt is invalid.");
      }
      return {
        attemptCount: row.attempt_count,
        email: accountEmailSchema.parse(row.email),
        leaseToken,
        notificationId: resourceIdSchema.parse(row.notification_id),
      };
    },

    async complete(command) {
      const row = await database.trusted(
        async (query) =>
          (
            await query.rows<{ saved: boolean | null }>(
              "SELECT complete_security_notification($1,$2,$3) AS saved",
              [
                command.notificationId,
                hashSecret(command.leaseToken, options.pepper),
                options.clock.now(),
              ],
            )
          )[0],
      );
      requireSaved(row?.saved);
    },

    async retry(command) {
      const row = await database.trusted(
        async (query) =>
          (
            await query.rows<{ saved: boolean | null }>(
              "SELECT retry_security_notification($1,$2,$3,$4) AS saved",
              [
                command.notificationId,
                hashSecret(command.leaseToken, options.pepper),
                command.availableAt,
                options.clock.now(),
              ],
            )
          )[0],
      );
      requireSaved(row?.saved);
    },
  };
}
