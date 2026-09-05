import { expect, it, vi } from "vitest";
import { createExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { StoredExtensionSession } from "./extension-session-vault.js";

it("coalesces refreshes and preserves the five minute freshness window across worker restarts", async () => {
  let now = 1_000_000;
  let session: StoredExtensionSession | null = {
    token: "t".repeat(32),
    expiresAt: "2099-01-01T00:00:00Z",
    preferences: {
      extensionQueryModelMode: "platform",
      cloudWordCopyMode: "disabled",
      studyCaptureMode: "manual",
      revision: 1,
      updatedAt: "2026-09-05T00:00:00Z",
    },
  };
  const preferences = session.preferences;
  let resolve: (() => void) | undefined;
  const held = new Promise<void>((done) => {
    resolve = done;
  });
  const getExtensionPreferences = vi.fn(async () => {
    await held;
    return preferences;
  });
  const options = {
    now: () => now,
    clearAccountData: vi.fn(async () => undefined),
    vault: {
      readSession: async () => session,
      clearSession: async () => {
        session = null;
      },
      writeSession: async (value: StoredExtensionSession) => {
        session = value;
      },
    },
    api: {
      getExtensionPreferences,
      createPairing: vi.fn(),
      getPairing: vi.fn(),
      exchangePairing: vi.fn(),
      disconnectExtensionSession: vi.fn(),
    },
  };
  const cache = createExtensionPreferenceCache(options);
  const first = cache.sync();
  const second = cache.sync();
  await vi.waitFor(() => expect(getExtensionPreferences).toHaveBeenCalledOnce());
  resolve?.();
  await Promise.all([first, second]);
  await createExtensionPreferenceCache(options).sync();
  expect(getExtensionPreferences).toHaveBeenCalledOnce();
  now += 5 * 60_000;
  await cache.sync();
  expect(getExtensionPreferences).toHaveBeenCalledTimes(2);
  await cache.sync(true);
  expect(getExtensionPreferences).toHaveBeenCalledTimes(3);
});
