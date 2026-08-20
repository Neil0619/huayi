export interface SecurityNotificationClaim {
  attemptCount: number;
  email: string;
  leaseToken: string;
  notificationId: string;
}

export interface SecurityNotificationRepository {
  claim(): Promise<SecurityNotificationClaim | null>;
  complete(command: { leaseToken: string; notificationId: string }): Promise<void>;
  retry(command: { availableAt: Date; leaseToken: string; notificationId: string }): Promise<void>;
}

export interface SecurityNotificationSender {
  sendPasswordResetCompleted(command: { email: string; idempotencyKey: string }): Promise<void>;
}

function retryAt(now: Date, attemptCount: number): Date {
  const exponent = Math.min(30, Math.max(0, attemptCount - 1));
  const delayMs = Math.min(6 * 60 * 60_000, 60_000 * 2 ** exponent);
  return new Date(now.getTime() + delayMs);
}

export function createSecurityNotificationWorker(options: {
  now(): Date;
  repository: SecurityNotificationRepository;
  sender: SecurityNotificationSender;
}) {
  return {
    async runOne(): Promise<"failed" | "idle" | "sent"> {
      const claim = await options.repository.claim();
      if (claim === null) return "idle";
      try {
        await options.sender.sendPasswordResetCompleted({
          email: claim.email,
          idempotencyKey: claim.notificationId,
        });
        await options.repository.complete({
          leaseToken: claim.leaseToken,
          notificationId: claim.notificationId,
        });
        return "sent";
      } catch {
        await options.repository
          .retry({
            availableAt: retryAt(options.now(), claim.attemptCount),
            leaseToken: claim.leaseToken,
            notificationId: claim.notificationId,
          })
          .catch(() => undefined);
        return "failed";
      }
    },
  };
}

export type SecurityNotificationWorker = ReturnType<typeof createSecurityNotificationWorker>;
