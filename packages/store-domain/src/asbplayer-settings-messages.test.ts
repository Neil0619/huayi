import { describe, expect, it } from "vitest";

import { STORE_MESSAGE_VERSION } from "./messages.js";
import { classifyEnglishSelection, parseSelectionBoundaryEvidence } from "./selection.js";
import {
  parseStoreAsbplayerSettingsRequest,
  parseStoreAsbplayerSettingsResponse,
} from "./asbplayer-settings-messages.js";

describe("asbplayer presentation contracts", () => {
  const request = { messageVersion: STORE_MESSAGE_VERSION, type: "store/asbplayer-settings" };
  const response = {
    appearance: "silver",
    asbplayerMode: "english",
    asbplayerShortcut: null,
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/asbplayer-settings-result",
  };
  it("uses the new Store version and dedicated settings envelope", () => {
    expect(STORE_MESSAGE_VERSION).toBe(6);
    expect(parseStoreAsbplayerSettingsRequest(request)).toEqual(request);
    expect(parseStoreAsbplayerSettingsResponse(response)).toEqual(response);
  });
  it.each([
    { ...request, messageVersion: 5 },
    { ...request, channel: "private-routing" },
    { ...request, type: "store/content-settings" },
  ])("rejects incompatible or expanded requests", (value) => {
    expect(() => parseStoreAsbplayerSettingsRequest(value)).toThrow();
  });
  it.each([
    { ...response, asbplayerMode: "auto" },
    { ...response, asbplayerShortcut: { code: "Space" } },
    { ...response, appearance: "unknown" },
    { ...response, mediaUrl: "private-media" },
    { ...response, messageVersion: 5 },
  ])("rejects malformed preferences and unexpected media fields", (value) => {
    expect(() => parseStoreAsbplayerSettingsResponse(value)).toThrow();
  });
  it("classifies dedicated full subtitle evidence without changing word behavior", () => {
    const evidence = parseSelectionBoundaryEvidence({ kind: "asbplayer-subtitle-sentence" });
    expect(classifyEnglishSelection("Come with me", evidence)).toBe("sentence");
    expect(classifyEnglishSelection("Come", evidence)).toBe("word");
  });
});
