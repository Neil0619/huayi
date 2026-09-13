import { describe, expect, it } from "vitest";
import {
  startAnalysisGenerationRequestSchema,
  extensionQueryGenerationRequestSchema,
} from "./structured-teaching-requests.js";

describe("native generation source identity", () => {
  it("preserves raw source whitespace and Unicode only for explicit native generation", () => {
    const sourceText = '  "Go 😀."\r\nWe can.\t';
    const analysis = { sourceText, source: { type: "manual" }, selectionKind: "passage" };
    const query = {
      sourceText,
      sourceType: "web-selection",
      action: "explain",
      selectionKind: "passage",
    };
    expect(
      startAnalysisGenerationRequestSchema.parse({
        ...analysis,
        outputContract: "structured-teaching-v1",
      }).sourceText,
    ).toBe(sourceText);
    expect(
      extensionQueryGenerationRequestSchema.parse({
        ...query,
        outputContract: "structured-teaching-v1",
      }).sourceText,
    ).toBe(sourceText);
    expect(startAnalysisGenerationRequestSchema.parse(analysis).sourceText).toBe(sourceText.trim());
    expect(extensionQueryGenerationRequestSchema.parse(query).sourceText).toBe(sourceText.trim());
  });
  it.each([
    { action: "explain", selectionKind: "word" },
    { action: "explain", selectionKind: "phrase" },
    { action: "translate", selectionKind: "passage" },
  ])("keeps unchanged query result actions canonical: $action $selectionKind", (mode) => {
    const query = {
      ...mode,
      sourceText: "  We can.\t",
      sourceType: "web-selection",
      outputContract: "structured-teaching-v1",
    };
    expect(extensionQueryGenerationRequestSchema.parse(query).sourceText).toBe("We can.");
  });
});
