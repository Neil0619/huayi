import { describe, expect, it, vi } from "vitest";

import { createAccountPreferencesApp } from "./account-preferences-app.js";

describe("account preferences routes", () => {
  it("reads and updates the authenticated owner's strict global extension preferences", async () => {
    const current = {
      cloudWordCopyMode: "enabled" as const,
      dailyGoal: 3,
      extensionQueryModelMode: "platform" as const,
      revision: 1,
      studyCaptureMode: "manual" as const,
      timezone: "UTC",
      updatedAt: "2026-08-13T10:00:00.000Z",
    };
    const changed = {
      ...current,
      dailyGoal: 5,
      extensionQueryModelMode: "byok" as const,
      revision: 2,
      timezone: "Asia/Shanghai",
    };
    const read = vi.fn(async () => current);
    const update = vi.fn(async () => changed);
    const app = createAccountPreferencesApp({
      authenticate: () => "owner-1",
      repository: { read, update },
    });

    const response = await app.request("/v1/account/preferences");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(current);

    const changedResponse = await app.request("/v1/account/preferences", {
      body: JSON.stringify({
        dailyGoal: 5,
        expectedRevision: 1,
        extensionQueryModelMode: "byok",
        timezone: "Asia/Shanghai",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(changedResponse.status).toBe(200);
    expect(update).toHaveBeenCalledWith("owner-1", {
      dailyGoal: 5,
      expectedRevision: 1,
      extensionQueryModelMode: "byok",
      timezone: "Asia/Shanghai",
    });
    await expect(changedResponse.json()).resolves.toEqual(changed);
  });
});
