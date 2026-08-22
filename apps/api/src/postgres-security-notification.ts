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
              attempt_count: number | null;
              deadline_exceeded_count: number;
              delivery_deadline_at: Date | null;
              email: string | null;
              maximum_attempts_exceeded_count: number;
              notification_id: string | null;
              outcome: "delivery" | "terminalized";
            }>(
              `SELECT outcome,notification_id::text,email,attempt_count,delivery_deadline_at,
                deadline_exceeded_count,maximum_attempts_exceeded_count
             FROM claim_security_notification($1,$2,$3)`,
              [hashSecret(leaseToken, options.pepper), leaseExpiresAt, now],
            )
          )[0],
      );
      if (row === undefined) return null;
      if (row.outcome === "terminalized") {
        if (
          !Number.isInteger(row.deadline_exceeded_count) ||
          row.deadline_exceeded_count < 0 ||
          row.deadline_exceeded_count > 100 ||
          !Number.isInteger(row.maximum_attempts_exceeded_count) ||
          row.maximum_attempts_exceeded_count < 0 ||
          row.maximum_attempts_exceeded_count > 100 ||
          row.deadline_exceeded_count + row.maximum_attempts_exceeded_count < 1 ||
          row.deadline_exceeded_count + row.maximum_attempts_exceeded_count > 100
        ) {
          throw new Error("Security notification terminal count is invalid.");
        }
        return {
          deadlineExceededCount: row.deadline_exceeded_count,
          maximumAttemptsExceededCount: row.maximum_attempts_exceeded_count,
          type: "terminalized",
        };
      }
      if (
        row.outcome !== "delivery" ||
        row.attempt_count === null ||
        !Number.isInteger(row.attempt_count) ||
        row.attempt_count < 1 ||
        row.attempt_count > 8 ||
        row.email === null ||
        row.notification_id === null ||
        !(row.delivery_deadline_at instanceof Date) ||
        !Number.isFinite(row.delivery_deadline_at.getTime()) ||
        row.delivery_deadline_at.getTime() <= now.getTime()
      ) {
        throw new Error("Security notification attempt is invalid.");
      }
      return {
        attemptCount: row.attempt_count,
        deliveryDeadline: row.delivery_deadline_at,
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
