import { describe, expect, it } from "vitest";

import {
  accountPreferencesRequestSchema,
  accountPreferencesResponseSchema,
  identityHttpRoutes,
} from "./account-contracts.js";

describe("account preferences contracts", () => {
  it("defines one strict read/write projection and fixed route", () => {
    expect(identityHttpRoutes.accountPreferences).toBe("/v1/account/preferences");
    expect(
      accountPreferencesResponseSchema.parse({
        cloudWordCopyMode: "enabled",
        dailyGoal: 5,
        extensionQueryModelMode: "platform",
        revision: 1,
        studyCaptureMode: "manual",
        timezone: "Asia/Shanghai",
        updatedAt: "2026-08-13T10:00:00.000Z",
      }),
    ).toMatchObject({ dailyGoal: 5, extensionQueryModelMode: "platform" });
    expect(() =>
      accountPreferencesResponseSchema.parse({
        cloudWordCopyMode: "enabled",
        dailyGoal: 5,
        extensionQueryModelMode: "platform",
        ownerUserId: "user-1",
        revision: 1,
        studyCaptureMode: "manual",
        timezone: "Asia/Shanghai",
        updatedAt: "2026-08-13T10:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects invalid timezone and daily goal writes", () => {
    expect(() =>
      accountPreferencesRequestSchema.parse({
        dailyGoal: 0,
        expectedRevision: 1,
        timezone: "Asia/Shanghai",
      }),
    ).toThrow();
    expect(() =>
      accountPreferencesRequestSchema.parse({
        dailyGoal: 5,
        expectedRevision: 1,
        timezone: "Mars/Base",
      }),
    ).toThrow();
  });
});
