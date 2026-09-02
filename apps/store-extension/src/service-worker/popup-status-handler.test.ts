import { STORE_MESSAGE_VERSION, type StoreSettings } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handlePopupStatusMessage } from "./popup-status-handler.js";

const settings: StoreSettings = {
  defaultAction: "ask",
  globallyEnabled: true,
  networkConsent: { grantedAt: "2026-08-11T00:00:00.000Z", version: 1 },
  overlayTheme: "pearl",
  providerId: "deepseek",
  recipientAccess: {
    eudic: { consent: null, enabled: false },
    shanbay: { consent: null, enabled: false },
  },
  schemaVersion: 6,
  sitePolicy: { defaultAction: "allow", rules: [] },
  youtubeMode: "english",
  youtubeShortcut: null,
};

describe("Store popup status handler", () => {
  it("returns only operational non-secret settings to the exact popup", async () => {
    await expect(
      handlePopupStatusMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/popup-status" },
        { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
        "extension-id",
        {
          getAppearance: async () => "silver",
          getSettings: async () => settings,
          notifySettingsChanged: vi.fn(async () => undefined),
          setGloballyEnabled: vi.fn(async () => undefined),
          setOverlayTheme: vi.fn(async () => undefined),
        },
      ),
    ).resolves.toEqual({
      appearance: "silver",
      globallyEnabled: true,
      messageVersion: STORE_MESSAGE_VERSION,
      modelConsentGranted: true,
      overlayTheme: "pearl",
      providerId: "deepseek",
      type: "store/popup-status-result",
    });
  });

  it("does not read credentials or answer another extension page", async () => {
    const dependencies = {
      getAppearance: async () => "moon" as const,
      getSettings: async () => settings,
      notifySettingsChanged: vi.fn(async () => undefined),
      setGloballyEnabled: vi.fn(async () => undefined),
      setOverlayTheme: vi.fn(async () => undefined),
    };
    await expect(
      handlePopupStatusMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/popup-status" },
        { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
        "extension-id",
        dependencies,
      ),
    ).resolves.toMatchObject({ appearance: "moon", providerId: "deepseek" });
    await expect(
      handlePopupStatusMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/popup-status" },
        { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
        "extension-id",
        dependencies,
      ),
    ).resolves.toBeUndefined();
  });
});
