import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "@huayi/protocol";

import { renderOverlayPanel } from "./render-result.js";
import type { ResultOverlayState } from "./overlay-state.js";

const session = {
  action: "translate",
  anchorRect: {
    bottom: 120,
    height: 20,
    left: 80,
    right: 180,
    top: 100,
    width: 100,
  },
  selection: {
    context: "Context",
    selection: "Selection",
    selectionKind: "word",
  },
  startedAt: 1_000,
} as const;

function resultState(result: AnalysisResult): ResultOverlayState {
  return { ...session, result, status: "result" };
}

describe("renderOverlayPanel", () => {
  it.each<readonly [AnalysisResult, string]>([
    [
      {
        collocations: [
          { meaningZh: "刑事调查", text: "criminal investigation" },
          { meaningZh: "展开调查", text: "launch an investigation" },
        ],
        contextualMeaningZh: "调查",
        partOfSpeech: "noun",
        selectionKind: "word",
        similarTerms: [
          { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
          { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
          { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
        ],
        sourceText: "investigation",
        type: "translate-lexical",
      },
      "相似词",
    ],
    [
      {
        selectionKind: "paragraph",
        sourceText: "First.\nSecond.",
        translationZh: "第一句。\n第二句。",
        type: "translate-passage",
      },
      "第一句。\n第二句。",
    ],
    [
      {
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
        type: "explain-lexical",
      },
      "同义词",
    ],
    [
      {
        contextRole: "说明调查所处阶段。",
        keyExpressions: [{ meaningZh: "处于早期阶段", text: "in its early stages" }],
        mainStructure: "He said + 宾语从句",
        selectionKind: "sentence",
        sourceText: "He said it was in its early stages.",
        translationZh: "他说事情仍处于早期阶段。",
        type: "explain-sentence",
      },
      "语境作用",
    ],
  ])("renders %s", (result, expectedText) => {
    const panel = renderOverlayPanel(resultState(result), {
      onClose: () => undefined,
      onRetry: () => undefined,
    });

    expect(panel.textContent).toContain(expectedText);
  });

  it("shows a slow-processing hint after eight seconds", () => {
    const panel = renderOverlayPanel(
      { ...session, status: "loading" },
      { onClose: () => undefined, onRetry: () => undefined },
      9_001,
    );

    expect(panel.textContent).toContain("仍在处理");
  });

  it("renders retry only for retryable errors", () => {
    const panel = renderOverlayPanel(
      {
        ...session,
        error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
        status: "error",
      },
      { onClose: () => undefined, onRetry: () => undefined },
    );

    expect(panel.querySelector("[data-action='retry']")).not.toBeNull();

    const terminalPanel = renderOverlayPanel(
      {
        ...session,
        error: { code: "INTERNAL_ERROR", message: "处理失败。", retryable: false },
        status: "error",
      },
      { onClose: () => undefined, onRetry: () => undefined },
    );
    expect(terminalPanel.querySelector("[data-action='retry']")).toBeNull();
  });
});
