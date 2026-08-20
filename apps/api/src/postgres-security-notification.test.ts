import { describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresSecurityNotificationRepository } from "./postgres-security-notification.js";
import { hashSecret } from "./security.js";

function databaseWith(rows: AnalysisQuery["rows"]): AnalysisDatabase {
  return {
    async transaction() {
      throw new Error("not used");
    },
    async trusted(operation) {
      return operation({ rows });
    },
  };
}

describe("Postgres security notification repository", () => {
  it("maps opaque leases through one claim, retry, and completion", async () => {
    const now = new Date("2026-08-14T10:00:00.000Z");
    const leaseToken = Buffer.alloc(32, 7).toString("base64url");
    const pepper = "p".repeat(32);
    const calls: { parameters: readonly unknown[]; text: string }[] = [];
    const rows: AnalysisQuery["rows"] = async <Row>(text: string, parameters = []) => {
      calls.push({ parameters, text });
      if (text.includes("claim_security_notification")) {
        expect(parameters).toEqual([
          hashSecret(leaseToken, pepper),
          new Date("2026-08-14T10:02:00.000Z"),
          now,
        ]);
        return [
          {
            attempt_count: 2,
            email: "learner@example.test",
            notification_id: "32000000-0000-0000-0000-000000000001",
          },
        ] as Row[];
      }
      expect(parameters[1]).toBe(hashSecret(leaseToken, pepper));
      return [{ saved: true }] as Row[];
    };
    const repository = createPostgresSecurityNotificationRepository(databaseWith(rows), {
      clock: { now: () => now },
      pepper,
      secrets: { bytes: () => Buffer.alloc(32, 7) },
    });

    await expect(repository.claim()).resolves.toEqual({
      attemptCount: 2,
      email: "learner@example.test",
      leaseToken,
      notificationId: "32000000-0000-0000-0000-000000000001",
    });
    await expect(
      repository.retry({
        availableAt: new Date("2026-08-14T10:02:00.000Z"),
        leaseToken,
        notificationId: "32000000-0000-0000-0000-000000000001",
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.complete({
        leaseToken,
        notificationId: "32000000-0000-0000-0000-000000000001",
      }),
    ).resolves.toBeUndefined();
    expect(calls.map(({ text }) => text)).toEqual([
      expect.stringContaining("claim_security_notification"),
      expect.stringContaining("retry_security_notification"),
      expect.stringContaining("complete_security_notification"),
    ]);
  });

  it("returns null for an idle outbox and fences stale writes", async () => {
    let call = 0;
    const rows: AnalysisQuery["rows"] = async <Row>() => {
      call += 1;
      return (call === 1 ? [] : [{ saved: false }]) as Row[];
    };
    const repository = createPostgresSecurityNotificationRepository(databaseWith(rows), {
      clock: { now: () => new Date("2026-08-14T10:00:00.000Z") },
      pepper: "p".repeat(32),
      secrets: { bytes: () => Buffer.alloc(32, 7) },
    });

    await expect(repository.claim()).resolves.toBeNull();
    await expect(
      repository.complete({
        leaseToken: "l".repeat(43),
        notificationId: "32000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow("Security notification lease is stale.");
  });
});
