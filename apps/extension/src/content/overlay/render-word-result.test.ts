import { describe, expect, it } from "vitest";

import {
  handlers,
  lexicalExplanationResult,
  lexicalTranslationResult,
  resultState,
} from "./render-result.test-fixtures.js";
import { renderOverlayPanel } from "./render-result.js";

describe("word result presentation", () => {
  it("renders translation as a compact dictionary card", () => {
    const result = {
      ...lexicalTranslationResult,
      confusableWords: [
        {
          distinctionZh: "principal 常指主要的或负责人，principle 指原则。",
          meaningZh: "主要的；负责人",
          partOfSpeech: "adjective" as const,
          text: "principal",
        },
      ],
    };
    const panel = renderOverlayPanel(resultState(result), handlers);
    const content = panel.querySelector(".huayi-analysis-content");
    const lexeme = panel.querySelector('[data-huayi-section="source"]');

    expect(panel.dataset.status).toBe("result");
    expect(panel.dataset.selectionKind).toBe("word");
    expect(content?.classList.contains("huayi-word-result")).toBe(true);
    expect(lexeme?.classList.contains("huayi-lexeme-header")).toBe(true);
    expect(lexeme?.querySelector(".huayi-source")?.textContent).toBe("investigation");
    expect(lexeme?.querySelector(".huayi-pronunciation")?.textContent).toContain(
      "/ɪnˌvestɪˈɡeɪʃn/",
    );
    expect(
      Array.from(panel.querySelectorAll(".huayi-section-title"), (heading) => heading.textContent),
    ).not.toContain("音标");
    expect(panel.querySelector('[data-huayi-section="contextual-sense"]')?.classList).toContain(
      "huayi-context-section",
    );
    expect(
      panel.querySelector('[data-huayi-section="contextual-sense"] .huayi-pos-badge')?.textContent,
    ).toBe("n.");
    expect(
      panel.querySelector('[data-huayi-section="common-phrases"] .huayi-entry-primary')
        ?.textContent,
    ).toBe("criminal investigation");
    expect(
      panel.querySelector('[data-huayi-section="common-phrases"] .huayi-entry-secondary')
        ?.textContent,
    ).toBe("刑事调查");
    expect(
      panel.querySelector('[data-huayi-section="confusable-words"] .huayi-entry-detail')
        ?.textContent,
    ).toContain("principle 指原则");
  });

  it("renders explanation with structured form, usage, and comparison rows", () => {
    const panel = renderOverlayPanel(resultState(lexicalExplanationResult), handlers);

    expect(panel.querySelector('[data-huayi-section="contextual-analysis"]')?.classList).toContain(
      "huayi-context-section",
    );
    expect(
      panel.querySelector('[data-huayi-section="word-form"] .huayi-entry-primary')?.textContent,
    ).toBe("原形");
    expect(
      panel.querySelector('[data-huayi-section="word-form"] .huayi-entry-secondary')?.textContent,
    ).toBe("investigation");
    expect(
      panel.querySelector('[data-huayi-section="usage-notes"] .huayi-entry-primary')?.textContent,
    ).toBe("搭配");
    expect(
      panel.querySelector('[data-huayi-section="synonym-comparisons"] .huayi-entry-detail')
        ?.textContent,
    ).toBe("更强调询问或查问。");
  });
});
