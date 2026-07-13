import { describe, expect, it } from "vitest";

import {
  appendCollocations,
  appendContextExample,
  appendCoreMeanings,
  appendPartOfSpeech,
  appendPronunciation,
  appendRelatedTerms,
  appendSource,
  appendTextSection,
} from "./render-analysis-sections.js";

function headings(container: HTMLElement): (string | null)[] {
  return Array.from(
    container.querySelectorAll(".huayi-section-title"),
    (heading) => heading.textContent,
  );
}

describe("analysis section DOM helpers", () => {
  it("creates no heading for empty, null, or absent sections", () => {
    const body = document.createElement("div");

    appendTextSection(body, "构词", null);
    appendPronunciation(body, null);
    appendCollocations(body, []);
    appendCollocations(body, null);
    appendCoreMeanings(body, []);
    appendRelatedTerms(body, "相似词", []);
    appendRelatedTerms(body, "同义词", null);

    expect(headings(body)).toEqual([]);
    expect(body.children).toHaveLength(0);
  });

  it("uses textContent for every page and model value", () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true">';
    const body = document.createElement("div");

    appendSource(body, hostile);
    appendTextSection(body, "语境义", hostile);
    appendPartOfSpeech(body, "number");
    appendPronunciation(body, { uk: hostile, us: hostile });
    appendCollocations(body, [{ meaningZh: hostile, text: hostile }]);
    appendContextExample(body, { english: hostile, translationZh: hostile });
    appendCoreMeanings(body, [{ meaningZh: hostile, partOfSpeech: "number" }]);
    appendRelatedTerms(body, "相似词", [
      { meaningZh: hostile, partOfSpeech: "number", text: hostile },
    ]);

    expect(body.querySelector("img")).toBeNull();
    expect(body.textContent).toContain(hostile);
    expect(body.textContent).toContain("num.");
    expect(headings(body)).toEqual([
      "语境义",
      "词性",
      "音标",
      "语境搭配",
      "原文例句",
      "核心词义",
      "相似词",
    ]);
  });
});
