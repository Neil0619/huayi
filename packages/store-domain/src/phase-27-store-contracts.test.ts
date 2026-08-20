import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  classifyEnglishSelection,
  parseAnalysisClientMessage,
  storeAnalysisResultSchema,
} from "./index.js";

describe("Phase 27 Store contracts", () => {
  it("uses trusted structure before local punctuation heuristics", () => {
    expect(
      classifyEnglishSelection("You should have told me", {
        kind: "youtube-subtitle-sentence",
      }),
    ).toBe("sentence");
    expect(
      classifyEnglishSelection("First sentence. Second sentence.", {
        kind: "dom-passage",
      }),
    ).toBe("passage");
    expect(classifyEnglishSelection("First sentence. Second sentence.")).toBe("passage");
    expect(
      classifyEnglishSelection("in the early stages", {
        kind: "local-rules",
      }),
    ).toBe("phrase");
  });

  it("accepts compact passage results without changing ResultCard detail by provider", () => {
    expect(
      storeAnalysisResultSchema.parse({
        requestId: "request-1",
        selectionKind: "passage",
        sourceText: "First sentence. Second sentence.",
        translationZh: "第一句。第二句。",
        type: "translate-passage",
      }),
    ).toBeTruthy();
  });

  it("rejects the old raw context message and accepts content-free boundary evidence", () => {
    const request = {
      action: "translate",
      boundaryEvidence: { kind: "dom-sentence" },
      messageVersion: STORE_MESSAGE_VERSION,
      selection: "You should have told me",
      sentenceContext: null,
      type: "store/analysis-start",
    } as const;
    expect(parseAnalysisClientMessage(request)).toEqual(request);
    expect(() =>
      parseAnalysisClientMessage({
        ...request,
        context: "A whole neighboring DOM paragraph that was not selected.",
      }),
    ).toThrow();
  });
});
