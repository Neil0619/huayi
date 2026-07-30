import { describe, expect, it } from "vitest";

import { findUniqueLemmaCandidate } from "./word-lemma.js";

describe("findUniqueLemmaCandidate", () => {
  it.each([
    ["orbiting", "orbit"],
    ["doodling", "doodle"],
    ["edges", "edge"],
    ["molecules", "molecule"],
    ["farthest", "far"],
    ["knives", "knife"],
  ])("returns the only changed noun, verb, or adjective lemma for %s", (word, expected) => {
    expect(findUniqueLemmaCandidate(word)).toEqual({
      candidates: [expected],
      kind: "unique",
      word: expected,
    });
  });

  it.each(["splendidly", "x", "stdio"])("does not guess an unsupported lemma for %s", (word) => {
    expect(findUniqueLemmaCandidate(word)).toEqual({ candidates: [], kind: "none" });
  });

  it("keeps multiple distinct part-of-speech lemmas ambiguous", () => {
    expect(findUniqueLemmaCandidate("axes")).toEqual({
      candidates: ["ax", "axe"],
      kind: "ambiguous",
    });
  });
});
