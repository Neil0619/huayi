import { describe, expect, it, vi } from "vitest";

import { createAccountProfileApp } from "./account-profile-app.js";

const account = {
  email: "learner@example.com",
  extensionSessions: [],
  minSupportedExtensionVersion: "1.0.0",
  preferences: {
    cloudWordCopyMode: "enabled" as const,
    dailyGoal: 5,
    extensionQueryModelMode: "platform" as const,
    revision: 1,
    studyCaptureMode: "manual" as const,
    timezone: "UTC",
    updatedAt: "2026-08-13T10:00:00.000Z",
  },
};

describe("current account route", () => {
  it("authenticates one owner and returns a strict no-store snapshot", async () => {
    const read = vi.fn(async () => account);
    const app = createAccountProfileApp({ authenticate: () => "owner-1", module: { read } });

    const response = await app.request("/v1/account");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(read).toHaveBeenCalledWith("owner-1");
    await expect(response.json()).resolves.toEqual(account);
  });

  it("fails closed when an adapter returns an obsolete account consent field", async () => {
    const app = createAccountProfileApp({
      authenticate: () => "owner-1",
      module: { read: async () => ({ ...account, consentVersion: "1" }) },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect((await app.request("/v1/account")).status).toBe(500);
    } finally {
      error.mockRestore();
    }
  });
});
