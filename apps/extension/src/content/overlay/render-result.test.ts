import { describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "@huayi/protocol";

import type {
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
  WordbookUiState,
} from "./overlay-state.js";
import {
  handlers,
  lexicalExplanationResult,
  lexicalTranslationResult,
  passageTranslationResult,
  resultState,
  sentenceExplanationResult,
  session,
} from "./render-result.test-fixtures.js";
import { renderOverlayPanel } from "./render-result.js";

function wordbookButton(panel: HTMLElement): HTMLButtonElement | null {
  return panel.querySelector<HTMLButtonElement>("[data-action='add-word']");
}

function withAvailability<
  T extends LoadingOverlayState | StreamingOverlayState | ResultOverlayState,
>(
  state: T,
  availability: WordbookUiState["availability"],
): Omit<T, "wordbook"> & { wordbook: WordbookUiState } {
  const wordbook: WordbookUiState = { availability, mutation: { status: "idle" } };
  return { ...state, wordbook };
}

describe("renderOverlayPanel", () => {
  it.each<readonly [AnalysisResult, string]>([
    [lexicalTranslationResult, "相似词"],
    [passageTranslationResult, "第一句。\n第二句。"],
    [
      {
        ...lexicalExplanationResult,
        collocations: [
          { meaningZh: "持续高温", text: "sustained heat" },
          { meaningZh: "持续努力", text: "sustained effort" },
        ],
        contextualMeaningZh: "持续的",
        coreMeanings: [{ meaningZh: "使持续", partOfSpeech: "verb" }],
        selectionKind: "phrase",
        sourceText: "sustained heatwave",
        synonyms: [
          { meaningZh: "连续的", partOfSpeech: "adjective", text: "continuous" },
          { meaningZh: "持久的", partOfSpeech: "adjective", text: "prolonged" },
          { meaningZh: "不间断的", partOfSpeech: "adjective", text: "uninterrupted" },
        ],
      },
      "同义词",
    ],
    [sentenceExplanationResult, "语境作用"],
  ])("renders %s", (result, expectedText) => {
    expect(renderOverlayPanel(resultState(result), handlers).textContent).toContain(expectedText);
  });

  it.each([
    [
      "translation",
      lexicalTranslationResult,
      ["语境义", "词性", "音标", "语境搭配", "原文例句", "相似词"],
    ],
    [
      "explanation",
      lexicalExplanationResult,
      ["语境义", "原形", "构词", "核心词义", "语境搭配", "同义词"],
    ],
  ] as const)("uses the fixed lexical section order for %s", (_label, result, expectedHeadings) => {
    const panel = renderOverlayPanel(resultState(result), handlers);

    expect(
      Array.from(panel.querySelectorAll(".huayi-section-title"), (heading) => heading.textContent),
    ).toEqual(expectedHeadings);
  });

  it("renders Four without headings for empty or absent lexical sections", () => {
    const translation = renderOverlayPanel(
      resultState({
        collocations: [],
        contextualMeaningZh: "四",
        partOfSpeech: "number",
        selectionKind: "word",
        similarTerms: [],
        sourceText: "Four",
        type: "translate-lexical",
      }),
      handlers,
    );
    const explanation = renderOverlayPanel(
      resultState({
        collocations: [],
        contextualMeaningZh: "四",
        coreMeanings: [{ meaningZh: "四", partOfSpeech: "number" }],
        selectionKind: "word",
        sourceText: "Four",
        synonyms: [],
        type: "explain-lexical",
      }),
      handlers,
    );

    for (const panel of [translation, explanation]) {
      expect(panel.textContent).toContain("Four");
      expect(panel.textContent).toContain("四");
      expect(panel.textContent).toContain("num.");
      const headings = Array.from(
        panel.querySelectorAll(".huayi-section-title"),
        (heading) => heading.textContent,
      );
      expect(headings).not.toContain("构词");
      expect(headings).not.toContain("语境搭配");
      expect(headings).not.toContain("同义词");
      expect(headings).not.toContain("相似词");
    }
  });

  it("shows a slow-processing hint after eight seconds", () => {
    const panel = renderOverlayPanel({ ...session, status: "loading" }, handlers, 9_001);

    expect(panel.textContent).toContain("仍在处理");
  });

  it("renders retry only for retryable errors", () => {
    const retryable = renderOverlayPanel(
      {
        ...session,
        error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
        preview: { lastSequence: -1, sections: {}, text: {} },
        status: "error",
      },
      handlers,
    );
    expect(retryable.querySelector("[data-action='retry']")).not.toBeNull();

    const terminal = renderOverlayPanel(
      {
        ...session,
        error: { code: "INTERNAL_ERROR", message: "处理失败。", retryable: false },
        preview: { lastSequence: -1, sections: {}, text: {} },
        status: "error",
      },
      handlers,
    );
    expect(terminal.querySelector("[data-action='retry']")).toBeNull();
  });

  it("renders deltas without a spinner and retains an incomplete preview after analysis error", () => {
    const streaming = renderOverlayPanel(
      {
        ...session,
        preview: {
          lastSequence: 0,
          sections: {},
          text: { translation: "正在逐步显示译文" },
        },
        status: "streaming",
      },
      handlers,
    );
    expect(streaming.textContent).toContain("正在逐步显示译文");
    expect(streaming.querySelector(".huayi-spinner")).toBeNull();

    const failed = renderOverlayPanel(
      {
        ...session,
        error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
        preview: { lastSequence: 0, sections: {}, text: { translation: "部分译文" } },
        status: "error",
      },
      handlers,
    );
    expect(failed.textContent).toContain("部分译文");
    expect(failed.textContent).toContain("内容未完整生成");
    expect(failed.querySelector("[data-action='retry']")).not.toBeNull();
  });

  it("places the wordbook action immediately left of close in the header action group", () => {
    const panel = renderOverlayPanel(resultState(lexicalTranslationResult), handlers);
    const group = panel.querySelector(".huayi-header-actions");
    const button = wordbookButton(panel);
    const close = panel.querySelector("[data-action='close']");

    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toBe("加入欧路生词本");
    expect(button?.closest(".huayi-header-actions")).toBe(group);
    expect(close?.parentElement).toBe(group);
    expect(button?.closest(".huayi-wordbook")?.nextElementSibling).toBe(close);
  });

  it.each<
    readonly [string, LoadingOverlayState | StreamingOverlayState, boolean, string | undefined]
  >([
    ["loading/checking", { ...session, status: "loading" }, false, undefined],
    [
      "loading/present",
      withAvailability({ ...session, status: "loading" }, "present"),
      true,
      "已加入生词本",
    ],
    [
      "streaming/present",
      withAvailability(
        {
          ...session,
          preview: { lastSequence: 0, sections: {}, text: { translation: "部分" } },
          status: "streaming",
        },
        "present",
      ),
      true,
      "已加入生词本",
    ],
  ])("renders header action policy for %s", (_label, state, visible, label) => {
    const button = wordbookButton(renderOverlayPanel(state, handlers));

    expect(button !== null).toBe(visible);
    expect(button?.textContent).toBe(label);
    if (button !== null) {
      expect(button.disabled).toBe(true);
    }
  });

  it.each(["checking", "absent", "unknown"] as const)(
    "enables add immediately for a complete result while availability is %s",
    (availability) => {
      const state = withAvailability(resultState(lexicalTranslationResult), availability);
      const onAddWord = vi.fn();
      const button = wordbookButton(renderOverlayPanel(state, { ...handlers, onAddWord }));
      button?.click();

      expect(button?.textContent).toBe("加入欧路生词本");
      expect(button?.disabled).toBe(false);
      expect(onAddWord).toHaveBeenCalledOnce();
    },
  );

  it("replaces add with disabled success when a late presence check completes", () => {
    const checking = renderOverlayPanel(resultState(lexicalTranslationResult), handlers);
    const present = renderOverlayPanel(
      withAvailability(resultState(lexicalTranslationResult), "present"),
      handlers,
    );

    expect(wordbookButton(checking)?.textContent).toBe("加入欧路生词本");
    expect(wordbookButton(present)?.textContent).toBe("已加入生词本");
    expect(wordbookButton(present)?.disabled).toBe(true);
    expect(wordbookButton(present)?.closest(".huayi-header-actions")).not.toBeNull();
  });

  it.each(["absent", "unknown"] as const)(
    "waits for a complete result before offering add when availability is %s",
    (availability) => {
      const loading = withAvailability({ ...session, status: "loading" }, availability);
      const streaming = withAvailability(
        {
          ...session,
          preview: { lastSequence: 0, sections: {}, text: { translation: "部分" } },
          status: "streaming",
        },
        availability,
      );

      expect(wordbookButton(renderOverlayPanel(loading, handlers))).toBeNull();
      expect(wordbookButton(renderOverlayPanel(streaming, handlers))).toBeNull();
      expect(
        wordbookButton(
          renderOverlayPanel(
            withAvailability(resultState(lexicalTranslationResult), availability),
            handlers,
          ),
        )?.disabled,
      ).toBe(false);
    },
  );

  it.each([
    [{ status: "saving" } as const, "正在添加…"],
    [{ status: "success" } as const, "已加入生词本"],
  ])("disables the action while mutation is $0", (mutation, label) => {
    const base = resultState(lexicalTranslationResult);
    const panel = renderOverlayPanel(
      { ...base, wordbook: { ...base.wordbook, mutation } },
      handlers,
    );

    expect(wordbookButton(panel)?.textContent).toBe(label);
    expect(wordbookButton(panel)?.disabled).toBe(true);
  });

  it("keeps the result visible and puts add errors in an aria-live row below the header", () => {
    const base = resultState(lexicalTranslationResult);
    const malicious = '<img src=x onerror="globalThis.pwned=true">';
    const state: ResultOverlayState = {
      ...base,
      result: { ...lexicalTranslationResult, contextualMeaningZh: malicious },
      wordbook: {
        ...base.wordbook,
        mutation: {
          error: { code: "NETWORK_ERROR", message: malicious, retryable: true },
          status: "error",
        },
      },
    };
    const panel = renderOverlayPanel(state, handlers);
    const feedback = panel.querySelector(".huayi-wordbook-error");

    expect(panel.textContent).toContain(malicious);
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.textContent).toContain("相似词");
    expect(feedback?.getAttribute("aria-live")).toBe("polite");
    expect(panel.querySelector(".huayi-header")?.nextElementSibling).toBe(feedback);
    expect(wordbookButton(panel)?.disabled).toBe(false);
  });

  it("disables retry after a rate-limited add error", () => {
    const base = resultState(lexicalTranslationResult);
    const panel = renderOverlayPanel(
      {
        ...base,
        wordbook: {
          ...base.wordbook,
          mutation: {
            error: { code: "RATE_LIMITED", message: "请求过于频繁。", retryable: false },
            status: "error",
          },
        },
      },
      handlers,
    );
    expect(wordbookButton(panel)?.disabled).toBe(true);
  });

  it.each([
    [
      "phrase",
      resultState(
        { ...lexicalExplanationResult, selectionKind: "phrase" },
        {
          selection: {
            ...session.selection,
            selectionKind: "phrase",
            wordbookContext: null,
          },
        },
      ),
    ],
    ["sentence", resultState(sentenceExplanationResult)],
    ["paragraph", resultState(passageTranslationResult)],
    [
      "phrase while loading",
      {
        ...session,
        selection: { ...session.selection, selectionKind: "phrase", wordbookContext: null },
        status: "loading",
        wordbook: { availability: "present", mutation: { status: "idle" } },
      },
    ],
  ] as const)("never shows the action for %s", (_label, state) => {
    expect(wordbookButton(renderOverlayPanel(state, handlers))).toBeNull();
  });

  it("does not enable add when the completed lexical result itself is not a word", () => {
    const mismatched = resultState({ ...lexicalTranslationResult, selectionKind: "phrase" });

    expect(wordbookButton(renderOverlayPanel(mismatched, handlers))).toBeNull();
  });
});
