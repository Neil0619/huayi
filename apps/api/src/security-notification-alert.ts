import type {
  SecurityNotificationAlert,
  SecurityNotificationAlertReason,
} from "./security-notification-worker.js";

export interface SecurityNotificationAlertRecord {
  count: number;
  event: "security-notification-alert";
  reason: SecurityNotificationAlertReason;
}

const reasons = new Set<SecurityNotificationAlertReason>([
  "delivery-deadline-exceeded",
  "maximum-attempts-exhausted",
  "persistence-completion-failed",
  "persistence-retry-failed",
  "provider-delivery-failed",
]);

export function createSecurityNotificationAlert(
  write: (record: SecurityNotificationAlertRecord) => void = (record) => console.error(record),
): SecurityNotificationAlert {
  return {
    async notify(command) {
      if (!Number.isInteger(command.count) || command.count < 1 || command.count > 100) {
        throw new Error("Security notification alert is invalid.");
      }
      if (!reasons.has(command.reason)) {
        throw new Error("Security notification alert is invalid.");
      }
      write({ count: command.count, event: "security-notification-alert", reason: command.reason });
    },
  };
}
