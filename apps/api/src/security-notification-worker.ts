export interface SecurityNotificationClaim {
  attemptCount: number;
  deliveryDeadline: Date;
  email: string;
  leaseToken: string;
  notificationId: string;
}

export interface SecurityNotificationTerminalizedClaim {
  deadlineExceededCount: number;
  maximumAttemptsExceededCount: number;
  type: "terminalized";
}

export type SecurityNotificationClaimResult =
  SecurityNotificationClaim | SecurityNotificationTerminalizedClaim | null;

export type SecurityNotificationAlertReason =
  | "delivery-deadline-exceeded"
  | "maximum-attempts-exhausted"
  | "persistence-completion-failed"
  | "persistence-retry-failed"
  | "provider-delivery-failed";

export interface SecurityNotificationAlert {
  notify(command: { count: number; reason: SecurityNotificationAlertReason }): Promise<void>;
}

export interface SecurityNotificationRepository {
  claim(): Promise<SecurityNotificationClaimResult>;
  complete(command: { leaseToken: string; notificationId: string }): Promise<void>;
  retry(command: { availableAt: Date; leaseToken: string; notificationId: string }): Promise<void>;
}

export interface SecurityNotificationSender {
  sendPasswordResetCompleted(command: { email: string; idempotencyKey: string }): Promise<void>;
}

function retryAt(now: Date, attemptCount: number, deliveryDeadline: Date): Date {
  const exponent = Math.min(30, Math.max(0, attemptCount - 1));
  const delayMs = Math.min(6 * 60 * 60_000, 60_000 * 2 ** exponent);
  return new Date(Math.min(now.getTime() + delayMs, deliveryDeadline.getTime()));
}

async function notify(
  alert: SecurityNotificationAlert,
  reason: SecurityNotificationAlertReason,
  count = 1,
): Promise<void> {
  if (count < 1) return;
  await alert.notify({ count, reason }).catch(() => undefined);
}

function terminalReason(
  claim: SecurityNotificationClaim,
  failedAt: Date,
): SecurityNotificationAlertReason | undefined {
  if (failedAt.getTime() >= claim.deliveryDeadline.getTime()) {
    return "delivery-deadline-exceeded";
  }
  if (claim.attemptCount >= 8) return "maximum-attempts-exhausted";
  return undefined;
}

export function createSecurityNotificationWorker(options: {
  alert: SecurityNotificationAlert;
  now(): Date;
  repository: SecurityNotificationRepository;
  sender: SecurityNotificationSender;
}) {
  return {
    async runOne(): Promise<"failed" | "idle" | "sent" | "terminalized"> {
      const claim = await options.repository.claim();
      if (claim === null) return "idle";
      if ("type" in claim) {
        await notify(options.alert, "delivery-deadline-exceeded", claim.deadlineExceededCount);
        await notify(
          options.alert,
          "maximum-attempts-exhausted",
          claim.maximumAttemptsExceededCount,
        );
        return "terminalized";
      }
      try {
        await options.sender.sendPasswordResetCompleted({
          email: claim.email,
          idempotencyKey: claim.notificationId,
        });
      } catch {
        const failedAt = options.now();
        const retried = await options.repository
          .retry({
            availableAt: retryAt(failedAt, claim.attemptCount, claim.deliveryDeadline),
            leaseToken: claim.leaseToken,
            notificationId: claim.notificationId,
          })
          .then(() => true)
          .catch(() => false);
        await notify(
          options.alert,
          retried
            ? (terminalReason(claim, failedAt) ?? "provider-delivery-failed")
            : "persistence-retry-failed",
        );
        return "failed";
      }
      try {
        await options.repository.complete({
          leaseToken: claim.leaseToken,
          notificationId: claim.notificationId,
        });
        return "sent";
      } catch {
        const failedAt = options.now();
        const retried = await options.repository
          .retry({
            availableAt: retryAt(failedAt, claim.attemptCount, claim.deliveryDeadline),
            leaseToken: claim.leaseToken,
            notificationId: claim.notificationId,
          })
          .then(() => true)
          .catch(() => false);
        await notify(
          options.alert,
          retried
            ? (terminalReason(claim, failedAt) ?? "persistence-completion-failed")
            : "persistence-retry-failed",
        );
        return "failed";
      }
    },
  };
}

export type SecurityNotificationWorker = ReturnType<typeof createSecurityNotificationWorker>;
