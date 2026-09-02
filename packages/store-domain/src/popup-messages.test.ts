import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  parseStorePopupStatusRequest,
  parseStorePopupStatusResponse,
  parseStorePopupPreferenceRequest,
} from "./index.js";

describe("Store popup status messages", () => {
  it("strictly excludes secrets and page authority", () => {
    expect(
      parseStorePopupStatusRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-status",
      }),
    ).toMatchObject({ type: "store/popup-status" });
    expect(() =>
      parseStorePopupStatusRequest({
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-status",
      }),
    ).toThrow();

    expect(
      parseStorePopupPreferenceRequest({
        enabled: false,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-global-toggle",
      }),
    ).toMatchObject({ enabled: false, type: "store/popup-global-toggle" });
    expect(
      parseStorePopupPreferenceRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "parchment",
        type: "store/popup-overlay-theme",
      }),
    ).toMatchObject({ overlayTheme: "parchment", type: "store/popup-overlay-theme" });

    expect(
      parseStorePopupStatusResponse({
        appearance: "silver",
        globallyEnabled: true,
        messageVersion: STORE_MESSAGE_VERSION,
        modelConsentGranted: true,
        overlayTheme: "pearl",
        providerId: "openai",
        type: "store/popup-status-result",
      }),
    ).toMatchObject({ appearance: "silver", providerId: "openai" });
    expect(() =>
      parseStorePopupStatusResponse({
        appearance: "silver",
        globallyEnabled: true,
        messageVersion: STORE_MESSAGE_VERSION,
        modelConsentGranted: true,
        overlayTheme: "pearl",
        providerId: "openai",
        secret: "sk-do-not-return",
        type: "store/popup-status-result",
      }),
    ).toThrow();
    expect(() =>
      parseStorePopupStatusResponse({
        appearance: "graphite",
        globallyEnabled: true,
        messageVersion: STORE_MESSAGE_VERSION,
        modelConsentGranted: true,
        overlayTheme: "pearl",
        providerId: "openai",
        type: "store/popup-status-result",
      }),
    ).toThrow();
  });
});
