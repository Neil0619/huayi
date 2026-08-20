import { describe, expect, it } from "vitest";

import { accountResourceSchema, identityHttpRoutes } from "./account-contracts.js";

const account = {
  email: "learner@example.com",
  extensionSessions: [
    {
      createdAt: "2026-08-13T10:00:00.000Z",
      deviceLabel: "Work Mac",
      expiresAt: "2026-11-11T10:00:00.000Z",
      id: "session-1",
      lastUsedAt: null,
    },
  ],
  minSupportedExtensionVersion: "1.0.0",
  preferences: {
    cloudWordCopyMode: "enabled",
    dailyGoal: 5,
    extensionQueryModelMode: "platform",
    revision: 3,
    studyCaptureMode: "manual",
    timezone: "Asia/Shanghai",
    updatedAt: "2026-08-13T10:00:00.000Z",
  },
};

describe("current account contract", () => {
  it("exposes the exact account route and nested owner snapshot", () => {
    expect(identityHttpRoutes.account).toBe("/v1/account");
    expect(accountResourceSchema.parse(account)).toEqual(account);
  });

  it("rejects the obsolete consent/status projection and all secret-shaped extras", () => {
    for (const extra of [
      { consentVersion: "1" },
      { installIdHash: "secret" },
      { ownerUserId: "10000000-0000-4000-8000-000000000001" },
      { sessionToken: "secret" },
      { status: "active" },
      { tokenHash: "secret" },
    ]) {
      expect(() => accountResourceSchema.parse({ ...account, ...extra })).toThrow();
    }
    expect(() => accountResourceSchema.parse({ ...account, email: "not-an-email" })).toThrow();
    expect(() =>
      accountResourceSchema.parse({
        ...account,
        preferences: { ...account.preferences, cloudWordCopyMode: undefined },
      }),
    ).toThrow();
  });

  it("rejects unsafe or non-canonical Extension versions", () => {
    for (const minSupportedExtensionVersion of [
      "01.0.0",
      "1.0",
      "1.0.0.0",
      "9007199254740992.0.0",
    ]) {
      expect(() =>
        accountResourceSchema.parse({ ...account, minSupportedExtensionVersion }),
      ).toThrow();
    }
  });
});
