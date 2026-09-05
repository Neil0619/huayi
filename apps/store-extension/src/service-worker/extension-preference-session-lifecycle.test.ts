import { describe, expect, it, vi } from "vitest";

import { createCloudSessionManager } from "./cloud-session-manager.js";
import { createExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { StoredExtensionSession } from "./extension-session-vault.js";

const original: StoredExtensionSession = {
  token: "t".repeat(32),
  expiresAt: "2099-01-01T00:00:00.000Z",
  preferences: {
    extensionQueryModelMode: "platform",
    cloudWordCopyMode: "enabled",
    studyCaptureMode: "manual",
    revision: 1,
    updatedAt: "2026-09-04T00:00:00.000Z",
  },
};

it.each([200, 401])("a late preference response (%s) cannot undo disconnect", async (status) => {
  let session: StoredExtensionSession | null = original;
  const vault = {
    readSession: async () => session,
    writeSession: async (value: StoredExtensionSession) => {
      session = value;
    },
    clearSession: async () => {
      session = null;
    },
    readPending: async () => null,
    clearPending: async () => undefined,
    getOrCreateInstallId: async () => "i".repeat(32),
    writePending: async () => undefined,
  };
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const api = {
    createPairing: vi.fn(),
    exchangePairing: vi.fn(),
    getPairing: vi.fn(),
    disconnectExtensionSession: vi.fn(async () => undefined),
    getExtensionPreferences: async () => {
      entered?.();
      await hold;
      if (status === 401) throw { status: 401 };
      return { ...original.preferences, revision: 2 };
    },
  };
  const clearAccountData = vi.fn(async () => undefined);
  const cache = createExtensionPreferenceCache({ api, clearAccountData, vault });
  const manager = createCloudSessionManager({
    api,
    clearSubmissions: clearAccountData,
    crypto: globalThis.crypto,
    open: async () => undefined,
    randomBytes: (size) => new Uint8Array(size),
    vault,
    webOrigin: "https://web.huayi.invalid",
  });
  const syncing = cache.sync();
  await started;
  await manager.disconnect();
  release?.();
  await expect(syncing).rejects.toMatchObject({ code: "cloud-session-required" });
  expect(await manager.status()).toEqual({ status: "disconnected" });
  expect(clearAccountData).toHaveBeenCalledOnce();
});

describe("account switching during a preference request", () => {
  it.each([200, 401])(
    "does not overwrite or clear a new account on old response %s",
    async (status) => {
      const replacement = { ...original, token: "n".repeat(32) };
      let session: StoredExtensionSession | null = original;
      const clearAccountData = vi.fn(async () => undefined);
      const cache = createExtensionPreferenceCache({
        clearAccountData,
        vault: {
          readSession: async () => session,
          clearSession: async () => {
            session = null;
          },
          writeSession: async (value) => {
            session = value;
          },
        },
        api: {
          getExtensionPreferences: async () => {
            session = replacement;
            if (status === 401) throw { status: 401 };
            return { ...original.preferences, revision: 2 };
          },
        } as never,
      });
      await expect(cache.sync()).rejects.toMatchObject({ code: "cloud-session-required" });
      expect(session).toEqual(replacement);
      expect(clearAccountData).not.toHaveBeenCalled();
    },
  );
});
