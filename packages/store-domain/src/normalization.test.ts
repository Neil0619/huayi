import { describe, expect, it } from "vitest";

import { normalizeHeadword, normalizeObservationSentence } from "./index.js";

describe("normalizeHeadword", () => {
  it("normalizes case, Unicode, whitespace, and apostrophes deterministically", () => {
    expect(normalizeHeadword("  CAFÉ\tD’ART  ")).toBe("café d'art");
    expect(normalizeHeadword("CAFE\u0301 D‘ART")).toBe("café d'art");
  });

  it("rejects empty or oversized headwords", () => {
    expect(() => normalizeHeadword(" \t ")).toThrow("Headword");
    expect(() => normalizeHeadword("a".repeat(201))).toThrow("Headword");
  });
});

describe("normalizeObservationSentence", () => {
  it("preserves case while normalizing Unicode and whitespace", () => {
    expect(normalizeObservationSentence("  CAFE\u0301\n  matters. ")).toBe("CAFÉ matters.");
  });
});
