import { describe, expect, it } from "vitest";
import { findBackfillLemma, findBackfillLemmaCandidates } from "./shanbay-lemma.js";

describe("Shanbay lemma candidates", () => {
  it.each([
    ["walking", "walk"],
    ["orbiting", "orbit"],
    ["edges", "edge"],
    ["went", "go"],
    ["children", "child"],
    ["farthest", "far"],
    [" Walking ", "walk"],
  ])("returns the distinct changed noun, verb or adjective candidate for %s", (word, lemma) => {
    expect(findBackfillLemmaCandidates(word)).toEqual([lemma]);
    expect(findBackfillLemma(word)).toBe(lemma);
  });

  it.each(["franky", "func", "msg", "rrf", "walk", "", "two words", "<script>"])(
    "does not invent a candidate for %s",
    (word) => {
      expect(findBackfillLemmaCandidates(word)).toEqual([]);
      expect(findBackfillLemma(word)).toBeNull();
    },
  );

  it("exposes both candidates for axes while keeping the unique wrapper ambiguous", () => {
    expect(findBackfillLemmaCandidates("axes")).toEqual(["ax", "axe"]);
    expect(findBackfillLemma("axes")).toBeNull();
  });
});
