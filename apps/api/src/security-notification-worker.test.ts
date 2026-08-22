import { describe, expect, it, vi } from "vitest";

import {
  createSecurityNotificationWorker,
  type SecurityNotificationRepository,
} from "./security-notification-worker.js";

const claim = {
  attemptCount: 3,
  deliveryDeadline: new Date("2026-08-15T09:00:00.000Z"),
  email: "learner@example.test",
  leaseToken: "l".repeat(43),
  notificationId: "32000000-0000-0000-0000-000000000001",
};

function repository(overrides: Partial<SecurityNotificationRepository> = {}) {
  return {
    claim: vi.fn(async () => claim),
    complete: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    ...overrides,
  } satisfies SecurityNotificationRepository;
}

function alert() {
  return { notify: vi.fn(async () => undefined) };
}

describe("security notification worker", () => {
  it("claims and completes one fixed password-reset notification", async () => {
    const storage = repository();
    const alerts = alert();
    const sendPasswordResetCompleted = vi.fn(async () => undefined);
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      alert: alerts,
      repository: storage,
      sender: { sendPasswordResetCompleted },
    });

    await expect(worker.runOne()).resolves.toBe("sent");
    expect(sendPasswordResetCompleted).toHaveBeenCalledWith({
      email: claim.email,
      idempotencyKey: claim.notificationId,
    });
    expect(storage.complete).toHaveBeenCalledWith({
      leaseToken: claim.leaseToken,
      notificationId: claim.notificationId,
    });
    expect(storage.retry).not.toHaveBeenCalled();
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  it("releases a failed delivery with bounded exponential backoff and exposes only a stable outcome", async () => {
    const storage = repository();
    const alerts = alert();
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      alert: alerts,
      repository: storage,
      sender: {
        async sendPasswordResetCompleted() {
          throw new Error("provider detail must not escape");
        },
      },
    });

    await expect(worker.runOne()).resolves.toBe("failed");
    expect(storage.retry).toHaveBeenCalledWith({
      availableAt: new Date("2026-08-14T10:04:00.000Z"),
      leaseToken: claim.leaseToken,
      notificationId: claim.notificationId,
    });
    expect(storage.complete).not.toHaveBeenCalled();
    expect(alerts.notify).toHaveBeenCalledWith({ count: 1, reason: "provider-delivery-failed" });
  });

  it("does no sender work when the durable outbox is idle", async () => {
    const storage = repository({ claim: vi.fn(async () => null) });
    const sendPasswordResetCompleted = vi.fn(async () => undefined);
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      alert: alert(),
      repository: storage,
      sender: { sendPasswordResetCompleted },
    });

    await expect(worker.runOne()).resolves.toBe("idle");
    expect(sendPasswordResetCompleted).not.toHaveBeenCalled();
  });

  it("keeps the public outcome bounded when releasing the lease also fails", async () => {
    const storage = repository({
      retry: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      alert: alert(),
      repository: storage,
      sender: {
        async sendPasswordResetCompleted() {
          throw new Error("mail unavailable");
        },
      },
    });

    await expect(worker.runOne()).resolves.toBe("failed");
  });

  it("terminalizes expired and exhausted work before the sender and raises only fixed counts", async () => {
    const sendPasswordResetCompleted = vi.fn(async () => undefined);
    const alerts = alert();
    const worker = createSecurityNotificationWorker({
      alert: alerts,
      now: () => new Date("2026-08-15T09:00:00.000Z"),
      repository: repository({
        claim: vi.fn(async () => ({
          deadlineExceededCount: 2,
          maximumAttemptsExceededCount: 3,
          type: "terminalized" as const,
        })),
      }),
      sender: { sendPasswordResetCompleted },
    });

    await expect(worker.runOne()).resolves.toBe("terminalized");
    expect(sendPasswordResetCompleted).not.toHaveBeenCalled();
    expect(alerts.notify.mock.calls).toEqual([
      [{ count: 2, reason: "delivery-deadline-exceeded" }],
      [{ count: 3, reason: "maximum-attempts-exhausted" }],
    ]);
  });

  it("replays a provider success with the same notification id only inside its deadline", async () => {
    let completeCalls = 0;
    const storage = repository({
      complete: vi.fn(async () => {
        completeCalls += 1;
        if (completeCalls === 1) throw new Error("database unavailable");
      }),
    });
    const sendPasswordResetCompleted = vi.fn(async () => undefined);
    const alerts = alert();
    const worker = createSecurityNotificationWorker({
      alert: alerts,
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      repository: storage,
      sender: { sendPasswordResetCompleted },
    });

    await expect(worker.runOne()).resolves.toBe("failed");
    await expect(worker.runOne()).resolves.toBe("sent");
    expect(sendPasswordResetCompleted).toHaveBeenCalledTimes(2);
    expect(sendPasswordResetCompleted.mock.calls).toEqual([
      [{ email: claim.email, idempotencyKey: claim.notificationId }],
      [{ email: claim.email, idempotencyKey: claim.notificationId }],
    ]);
    expect(alerts.notify).toHaveBeenCalledWith({
      count: 1,
      reason: "persistence-completion-failed",
    });
  });

  it("dead-letters a failed eighth attempt and alerts without delivery fields", async () => {
    const storage = repository({
      claim: vi.fn(async () => ({ ...claim, attemptCount: 8 })),
    });
    const alerts = alert();
    const worker = createSecurityNotificationWorker({
      alert: alerts,
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      repository: storage,
      sender: {
        async sendPasswordResetCompleted() {
          throw new Error("provider detail");
        },
      },
    });

    await expect(worker.runOne()).resolves.toBe("failed");
    expect(alerts.notify).toHaveBeenCalledWith({
      count: 1,
      reason: "maximum-attempts-exhausted",
    });
  });
});
