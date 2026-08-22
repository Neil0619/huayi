import { describe, expect, it } from "vitest";

import { segmentSentences } from "./analysis-segmentation.js";

describe("analysis segmentation", () => {
  it("segments deterministically while preserving common abbreviations", () => {
    expect(segmentSentences("Dr. Smith agreed. It works! Does it? Yes")).toEqual([
      { analysisUnitId: "u1", ordinal: 0, sourceText: "Dr. Smith agreed." },
      { analysisUnitId: "u2", ordinal: 1, sourceText: "It works!" },
      { analysisUnitId: "u3", ordinal: 2, sourceText: "Does it?" },
      { analysisUnitId: "u4", ordinal: 3, sourceText: "Yes" },
    ]);
  });
});
