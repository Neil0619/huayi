import type { AnalysisResult } from "@huayi/protocol";

import type { ResultOverlayState } from "./overlay-state.js";
import type { PanelHandlers } from "./render-result.js";

export const handlers: PanelHandlers = {
  onAddWord: () => undefined,
  onClose: () => undefined,
  onRetry: () => undefined,
};

export const lexicalTranslationResult = {
  commonMeanings: [
    { meaningsZh: ["调查", "侦查"], partOfSpeech: "noun" },
    { meaningsZh: ["研究"], partOfSpeech: "noun" },
  ],
  commonPhrases: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  confusableWords: [],
  contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
  dictionaryForm: "investigation",
  pronunciation: { uk: "/ɪnˌvestɪˈɡeɪʃn/", us: "/ɪnˌvestɪˈɡeɪʃən/" },
  selectionKind: "word",
  sourceText: "investigation",
  type: "translate-word",
} as const satisfies AnalysisResult;

export const lexicalExplanationResult = {
  contextualAnalysisZh: "此处指正在进行的正式调查，因为它作句子的主语。",
  selectionKind: "word",
  sourceText: "investigation",
  synonyms: [
    {
      distinctionZh: "更强调询问或查问。",
      meaningZh: "询问；调查",
      partOfSpeech: "noun",
      text: "inquiry",
    },
  ],
  type: "explain-word",
  usageNotes: [{ descriptionZh: "常与 into 连用。", titleZh: "搭配" }],
  wordForm: { baseForm: "investigation", formTypeZh: "名词单数", sentenceRoleZh: "主语" },
  wordFormationZh: "investigate + -ion",
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
