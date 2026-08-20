import { describe, expect, it, vi } from "vitest";

import { createExtensionPreferenceCache } from "./extension-preference-cache.js";

const original = {
  cloudWordCopyMode: "enabled" as const,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "manual" as const,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

function setup(api: null | { getExtensionPreferences: ReturnType<typeof vi.fn> }) {
  let session = {
    expiresAt: "2026-09-13T00:00:00.000Z",
    preferences: original,
    token: "t".repeat(32),
  };
  const vault = {
    clearSession: vi.fn(async () => undefined),
    readSession: vi.fn(async () => session),
    writeSession: vi.fn(async (value) => {
      session = value;
    }),
  };
  const clearAccountData = vi.fn(async () => undefined);
  const cache = createExtensionPreferenceCache({
    api: api as never,
    clearAccountData,
    now: () => Date.parse("2026-08-13T01:00:00.000Z"),
    vault,
  });
  return { cache, clearAccountData, session: () => session, vault };
}

describe("SW extension preference cache", () => {
  it("atomically replaces the session-bound snapshot with a newer server revision", async () => {
    const current = { ...original, extensionQueryModelMode: "byok" as const, revision: 2 };
    const context = setup({ getExtensionPreferences: vi.fn(async () => current) });

    await expect(context.cache.sync()).resolves.toEqual(current);
    expect(context.session().preferences).toEqual(current);
  });

  it("uses the valid cached snapshot on transient sync failure without changing model mode", async () => {
    const context = setup({
      getExtensionPreferences: vi.fn(async () => Promise.reject({ status: 503 })),
    });

    await expect(context.cache.sync()).resolves.toEqual(original);
    expect(context.vault.clearSession).not.toHaveBeenCalled();
  });

  it("clears the session and account-bound content on authentication failure", async () => {
    const context = setup({
      getExtensionPreferences: vi.fn(async () => Promise.reject({ status: 401 })),
    });

    await expect(context.cache.sync()).resolves.toBeNull();
    expect(context.vault.clearSession).toHaveBeenCalledOnce();
    expect(context.clearAccountData).toHaveBeenCalledOnce();
  });
});
