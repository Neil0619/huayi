import { describe, expect, it, vi } from "vitest";

import { createSecurityNotificationAlert } from "./security-notification-alert.js";

describe("security notification alert", () => {
  it("projects only a fixed reason and bounded count", async () => {
    const write = vi.fn();
    const alert = createSecurityNotificationAlert(write);

    await alert.notify({
      body: "private",
      count: 2,
      email: "private@example.test",
      notificationId: "private-id",
      reason: "maximum-attempts-exhausted",
    } as Parameters<typeof alert.notify>[0]);

    expect(write).toHaveBeenCalledWith({
      count: 2,
      event: "security-notification-alert",
      reason: "maximum-attempts-exhausted",
    });
    await expect(
      alert.notify({ count: 101, reason: "maximum-attempts-exhausted" }),
    ).rejects.toThrow("Security notification alert is invalid.");
  });
});
