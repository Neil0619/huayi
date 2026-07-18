import { describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "@huayi/protocol";

import type { ResultOverlayState, StreamingOverlayState } from "./overlay-state.js";
import { patchAnalysisBody } from "./patch-analysis-body.js";
import { lexicalTranslationResult, session } from "./render-result.test-fixtures.js";

function streamingState(
  overrides: Partial<StreamingOverlayState["preview"]> = {},
): StreamingOverlayState {
  return {
    ...session,
    preview: {
      lastSequence: 1,
      sections: {
        commonPhrases: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
        contextualSense: { meaningZh: "调", partOfSpeech: "noun" },
      },
      text: {},
      ...overrides,
    },
    status: "streaming",
  };
}

function resultState(result: AnalysisResult): ResultOverlayState {
  return { ...session, result, status: "result" };
}

describe("patchAnalysisBody", () => {
  it("does not retain enter classes when the document prefers reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
    try {
      const body = document.createElement("div");
      patchAnalysisBody(body, streamingState());

      expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      expect(body.querySelector(".huayi-enter")).toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("retains keyed sections and items while text grows and arrays append", () => {
    const body = document.createElement("div");
    patchAnalysisBody(body, streamingState());
    const meaning = body.querySelector<HTMLElement>('[data-huayi-section="contextual-sense"]');
    const meaningValue = meaning?.querySelector<HTMLElement>("[data-huayi-value]");
    const firstItem = body.querySelector<HTMLLIElement>('[data-huayi-section="common-phrases"] li');
    meaning?.classList.remove("huayi-enter");
    firstItem?.classList.remove("huayi-enter");

    patchAnalysisBody(
      body,
      streamingState({
        lastSequence: 3,
        sections: {
          commonPhrases: [
            { meaningZh: "刑事调查", text: "criminal investigation" },
            { meaningZh: "展开调查", text: "launch an investigation" },
          ],
          contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
        },
        text: {},
      }),
    );

    expect(body.querySelector('[data-huayi-section="contextual-sense"]')).toBe(meaning);
    expect(meaning?.querySelector("[data-huayi-value]")).toBe(meaningValue);
    expect(meaningValue?.textContent).toBe("调查");
    expect(meaning?.querySelector(".huayi-pos-badge")?.textContent).toBe("n.");
    const items = body.querySelectorAll('[data-huayi-section="common-phrases"] li');
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(firstItem);
    expect(items[0]?.classList.contains("huayi-enter")).toBe(false);
    expect(items[1]?.classList.contains("huayi-enter")).toBe(true);
    items[1]?.dispatchEvent(new Event("animationend"));
    expect(items[1]?.classList.contains("huayi-enter")).toBe(false);
    expect(body.querySelector('[data-huayi-section="pronunciation"]')).toBeNull();
  });

  it("keeps pronunciation inside the stable lexical header while streaming", () => {
    const body = document.createElement("div");
    patchAnalysisBody(
      body,
      streamingState({
        sections: {
          contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
          pronunciation: { uk: "/first/" },
        },
        text: {},
      }),
    );
    const header = body.querySelector('[data-huayi-section="source"]');
    const pronunciation = header?.querySelector('[data-huayi-section="pronunciation"]');

    patchAnalysisBody(
      body,
      streamingState({
        lastSequence: 2,
        sections: {
          contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
          pronunciation: { uk: "/final/", us: "/final-us/" },
        },
        text: {},
      }),
    );

    expect(body.querySelector('[data-huayi-section="source"]')).toBe(header);
    expect(header?.querySelector('[data-huayi-section="pronunciation"]')).toBe(pronunciation);
    expect(pronunciation?.textContent).toBe("英 /final/　美 /final-us/");
    expect(header?.nextElementSibling?.getAttribute("data-huayi-section")).toBe("contextual-sense");
  });

  it("renders hostile values as text and removes no preview section until the final result", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const body = document.createElement("div");
    patchAnalysisBody(
      body,
      streamingState({
        sections: {
          commonPhrases: [{ meaningZh: hostile, text: hostile }],
          contextualSense: { meaningZh: hostile, partOfSpeech: "noun" },
          pronunciation: { uk: "/test/" },
        },
        text: {},
      }),
    );

    expect(body.querySelector("img")).toBeNull();
    expect(body.textContent).toContain(hostile);
    expect(body.querySelector('[data-huayi-section="pronunciation"]')).not.toBeNull();

    patchAnalysisBody(
      body,
      streamingState({
        lastSequence: 2,
        sections: {},
        text: {},
      }),
    );
    expect(body.querySelector('[data-huayi-section="pronunciation"]')).not.toBeNull();

    patchAnalysisBody(
      body,
      resultState({
        commonMeanings: [{ meaningsZh: ["最终修正"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "最终修正", partOfSpeech: "noun" },
        dictionaryForm: "investigation",
        selectionKind: "word",
        sourceText: lexicalTranslationResult.sourceText,
        type: "translate-word",
      }),
    );
    expect(body.querySelector('[data-huayi-section="pronunciation"]')).toBeNull();
    expect(body.querySelector('[data-huayi-section="common-phrases"]')).toBeNull();
    expect(
      body.querySelector('[data-huayi-section="contextual-sense"] [data-huayi-value]')?.textContent,
    ).toBe("最终修正");
    expect(
      body.querySelector('[data-huayi-section="contextual-sense"] .huayi-pos-badge')?.textContent,
    ).toBe("n.");
  });

  it("corrects final text and list nodes without replacing the body or equal nodes", () => {
    const body = document.createElement("div");
    patchAnalysisBody(
      body,
      streamingState({
        sections: {
          commonPhrases: [
            { meaningZh: "旧一", text: "old one" },
            { meaningZh: "旧二", text: "old two" },
          ],
          contextualSense: { meaningZh: "旧义", partOfSpeech: "noun" },
        },
        text: {},
      }),
    );
    const meaning = body.querySelector('[data-huayi-section="contextual-sense"]');
    const items = body.querySelectorAll('[data-huayi-section="common-phrases"] li');

    patchAnalysisBody(
      body,
      resultState({
        ...lexicalTranslationResult,
        commonPhrases: [{ meaningZh: "新一", text: "new one" }],
        contextualSense: { meaningZh: "新义", partOfSpeech: "noun" },
      }),
    );

    expect(body.querySelector('[data-huayi-section="contextual-sense"]')).toBe(meaning);
    const correctedItems = body.querySelectorAll('[data-huayi-section="common-phrases"] li');
    expect(correctedItems).toHaveLength(1);
    expect(correctedItems[0]).toBe(items[0]);
    expect(correctedItems[0]?.querySelector(".huayi-entry-primary")?.textContent).toBe("new one");
    expect(correctedItems[0]?.querySelector(".huayi-entry-secondary")?.textContent).toBe("新一");
  });
});
