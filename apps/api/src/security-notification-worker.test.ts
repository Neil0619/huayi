import { describe, expect, it, vi } from "vitest";

import {
  createSecurityNotificationWorker,
  type SecurityNotificationRepository,
} from "./security-notification-worker.js";

const claim = {
  attemptCount: 3,
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

describe("security notification worker", () => {
  it("claims and completes one fixed password-reset notification", async () => {
    const storage = repository();
    const sendPasswordResetCompleted = vi.fn(async () => undefined);
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
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
  });

  it("releases a failed delivery with bounded exponential backoff and exposes only a stable outcome", async () => {
    const storage = repository();
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
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
  });

  it("does no sender work when the durable outbox is idle", async () => {
    const storage = repository({ claim: vi.fn(async () => null) });
    const sendPasswordResetCompleted = vi.fn(async () => undefined);
    const worker = createSecurityNotificationWorker({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
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
      repository: storage,
      sender: {
        async sendPasswordResetCompleted() {
          throw new Error("mail unavailable");
        },
      },
    });

    await expect(worker.runOne()).resolves.toBe("failed");
  });
});
