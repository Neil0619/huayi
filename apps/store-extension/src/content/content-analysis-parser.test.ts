import { parseAnalysisServerMessage, STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it } from "vitest";

import { parseContentAnalysisMessage } from "./content-analysis-parser.js";

function delta(text: unknown) {
  return {
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-update",
    update: { requestId: "request-1", type: "delta", section: "translation", sequence: 1, text },
  };
}

describe("content analysis stream contract", () => {
  it.each([
    { name: "space", text: " " },
    { name: "newline", text: "\n" },
    { name: "CRLF", text: "\r\n" },
    { name: "tab", text: "\t" },
    { name: "mixed whitespace", text: " \n\t" },
    { name: "maximum length", text: " ".repeat(4_096) },
  ])("preserves a whitespace-only $name delta accepted by the background contract", ({ text }) => {
    const message = parseAnalysisServerMessage(delta(text));
    expect(parseContentAnalysisMessage(message)).toEqual(message);
  });

  it.each([
    { name: "empty", text: "" },
    { name: "oversized", text: " ".repeat(4_097) },
    { name: "null", text: null },
    { name: "numeric", text: 1 },
  ])("rejects $name delta text", ({ text }) => {
    expect(() => parseAnalysisServerMessage(delta(text))).toThrow();
    expect(() => parseContentAnalysisMessage(delta(text))).toThrow();
  });

  it("still rejects blank completed text and extra preview fields", () => {
    expect(() =>
      parseContentAnalysisMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/analysis-result",
        result: {
          requestId: "request-1",
          sourceText: "Selected sentence.",
          selectionKind: "sentence",
          type: "translate-passage",
          translationZh: " ",
        },
      }),
    ).toThrow();
    const message = delta(" ");
    expect(() =>
      parseContentAnalysisMessage({ ...message, update: { ...message.update, html: "<br>" } }),
    ).toThrow();
  });
});
