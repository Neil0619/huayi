import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  parseStoreLexiconRequest,
  parseStoreLexiconResponse,
} from "./index.js";

describe("Store lexicon messages", () => {
  it("normalizes the candidate headword and accepts only bounded web observations", () => {
    expect(
      parseStoreLexiconRequest({
        contextualMeaningZh: "  调查  ",
        headword: " Investigation ",
        messageVersion: STORE_MESSAGE_VERSION,
        sentence: " The investigation began. ",
        type: "store/lexicon-save",
      }),
    ).toEqual({
      contextualMeaningZh: "调查",
      headword: "investigation",
      messageVersion: STORE_MESSAGE_VERSION,
      sentence: "The investigation began.",
      type: "store/lexicon-save",
    });
  });

  it.each(["url", "title", "modelResult", "targets"])(
    "rejects the untrusted %s authority field",
    (field) => {
      expect(() =>
        parseStoreLexiconRequest({
          contextualMeaningZh: "调查",
          headword: "investigation",
          messageVersion: STORE_MESSAGE_VERSION,
          sentence: "The investigation began.",
          type: "store/lexicon-save",
          [field]: "must-not-cross",
        }),
      ).toThrow();
    },
  );

  it("rejects forged sources, incompatible versions, and excessive meanings", () => {
    const request = {
      contextualMeaningZh: "调查",
      headword: "investigation",
      messageVersion: STORE_MESSAGE_VERSION,
      sentence: "The investigation began.",
      type: "store/lexicon-save",
    };
    expect(() => parseStoreLexiconRequest({ ...request, source: "youtube" })).toThrow();
    expect(() => parseStoreLexiconRequest({ ...request, messageVersion: 1 })).toThrow();
    expect(() =>
      parseStoreLexiconRequest({ ...request, contextualMeaningZh: "释".repeat(1_001) }),
    ).toThrow();
  });

  it("strictly parses presence and terminal responses", () => {
    expect(
      parseStoreLexiconRequest({
        headword: " Evidence ",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/lexicon-presence",
      }),
    ).toMatchObject({ headword: "evidence" });
    expect(
      parseStoreLexiconResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        status: "duplicate",
        type: "store/lexicon-save-result",
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(() =>
      parseStoreLexiconResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        status: "saved",
        type: "store/lexicon-save-result",
        url: "https://example.test",
      }),
    ).toThrow();
  });
});
