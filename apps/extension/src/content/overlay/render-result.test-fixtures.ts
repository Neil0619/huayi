import type { AnalysisResult } from "@huayi/protocol";

import type { ResultOverlayState } from "./overlay-state.js";
import type { PanelHandlers } from "./render-result.js";

export const handlers: PanelHandlers = {
  onAddWord: () => undefined,
  onClose: () => undefined,
  onRetry: () => undefined,
};

export const lexicalTranslationResult = {
  collocations: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  contextExample: {
    english: "The investigation continues.",
    translationZh: "调查仍在继续。",
  },
  contextualMeaningZh: "调查",
  partOfSpeech: "noun",
  pronunciation: { uk: "/ɪnˌvestɪˈɡeɪʃn/", us: "/ɪnˌvestɪˈɡeɪʃən/" },
  selectionKind: "word",
  similarTerms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  sourceText: "investigation",
  type: "translate-lexical",
} as const satisfies AnalysisResult;

export const lexicalExplanationResult = {
  baseForm: "investigate",
  collocations: [
    { meaningZh: "调查案件", text: "investigate a case" },
    { meaningZh: "开展调查", text: "conduct an investigation" },
  ],
  contextualMeaningZh: "调查",
  coreMeanings: [{ meaningZh: "调查", partOfSpeech: "noun" }],
  selectionKind: "word",
  sourceText: "investigation",
  synonyms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  type: "explain-lexical",
  wordFormation: "investigate + -ion",
} as const satisfies AnalysisResult;

export const passageTranslationResult = {
  selectionKind: "paragraph",
  sourceText: "First.\nSecond.",
  translationZh: "第一句。\n第二句。",
  type: "translate-passage",
} as const satisfies AnalysisResult;

export const sentenceExplanationResult = {
  contextRole: "说明调查所处阶段。",
  keyExpressions: [{ meaningZh: "处于早期阶段", text: "in its early stages" }],
  mainStructure: "He said + 宾语从句",
  selectionKind: "sentence",
  sourceText: "He said it was in its early stages.",
  translationZh: "他说事情仍处于早期阶段。",
  type: "explain-sentence",
} as const satisfies AnalysisResult;

export const session = {
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
    sentenceContext: "Selection context.",
    wordbookContext: "Selection context.",
  },
  startedAt: 1_000,
  wordbook: { availability: "checking", mutation: { status: "idle" } },
} as const;

export function resultState(
  result: AnalysisResult,
  overrides: Partial<Omit<ResultOverlayState, "result" | "status">> = {},
): ResultOverlayState {
  return { ...session, ...overrides, result, status: "result" };
}
