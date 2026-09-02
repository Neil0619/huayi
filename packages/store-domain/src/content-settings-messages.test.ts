import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  parseStoreContentSettingsRequest,
  parseStoreContentSettingsResponse,
} from "./index.js";

describe("Store content settings messages", () => {
  it("exposes only the versioned YouTube presentation preferences", () => {
    expect(
      parseStoreContentSettingsRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/content-settings",
      }),
    ).toEqual({ messageVersion: STORE_MESSAGE_VERSION, type: "store/content-settings" });
    expect(
      parseStoreContentSettingsResponse({
        appearance: "porcelain",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/content-settings-result",
        youtubeMode: "bilingual",
        youtubeShortcut: { alt: false, code: "KeyK", ctrl: true, meta: false, shift: false },
      }),
    ).toMatchObject({
      appearance: "porcelain",
      youtubeMode: "bilingual",
      youtubeShortcut: { code: "KeyK" },
    });
    expect(() =>
      parseStoreContentSettingsResponse({
        appearance: "porcelain",
        messageVersion: STORE_MESSAGE_VERSION,
        providerId: "openai",
        type: "store/content-settings-result",
        youtubeMode: "english",
        youtubeShortcut: null,
      }),
    ).toThrow();
    expect(() =>
      parseStoreContentSettingsResponse({
        appearance: "auto",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/content-settings-result",
        youtubeMode: "english",
        youtubeShortcut: null,
      }),
    ).toThrow();
  });
});
