import type { AnalysisRequest } from "@huayi/store-domain";

import {
  buildOpenAIPrompt,
  buildSystemInstructions,
  buildUntrustedInput,
} from "./analysis-prompt.js";
import { jsonSchemaFor, type ModelResultType } from "./model-contracts.js";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const OPENAI_MODEL = "gpt-5.6-luna";
export const DEEPSEEK_CHAT_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-v4-flash";

const EXAMPLES: Readonly<Record<ModelResultType, object>> = {
  "explain-lexical": {
    contextualMeaningZh: "语境释义",
    baseForm: null,
    wordFormation: null,
    coreMeanings: [{ meaningZh: "核心义", partOfSpeech: "phrase" }],
    collocations: [],
    synonyms: [],
  },
  "explain-sentence": {
    mainStructure: "句子结构",
    keyExpressions: [{ meaningZh: "含义", text: "English expression" }],
    translationZh: "完整翻译。",
    contextRole: "上下文作用",
  },
  "explain-word": {
    contextualAnalysisZh: "语境分析",
    wordForm: { baseForm: "example", formTypeZh: "原形", sentenceRoleZh: null },
    wordFormationZh: null,
    usageNotes: [],
    synonyms: [],
  },
  "translate-lexical": {
    contextualMeaningZh: "语境释义",
    partOfSpeech: "phrase",
    pronunciation: null,
    collocations: [],
    contextExampleTranslationZh: null,
    similarTerms: [],
  },
  "translate-passage": { translationZh: "完整翻译。" },
  "translate-word": {
    pronunciation: null,
    contextualSense: { meaningZh: "语境义", partOfSpeech: "noun" },
    dictionaryForm: "example",
    commonMeanings: [{ partOfSpeech: "noun", meaningsZh: ["常用义"] }],
    commonPhrases: [],
    confusableWords: [],
  },
};

export function buildOpenAIRequestBody(request: AnalysisRequest, type: ModelResultType): string {
  return JSON.stringify({
    input: buildOpenAIPrompt(request, type),
    model: OPENAI_MODEL,
    reasoning: { effort: "none" },
    store: false,
    stream: true,
    text: {
      format: {
        name: type.replaceAll("-", "_"),
        schema: jsonSchemaFor(type),
        strict: true,
        type: "json_schema",
      },
    },
  });
}

export function buildDeepSeekRequestBody(request: AnalysisRequest, type: ModelResultType): string {
  const system = [
    buildSystemInstructions(type),
    "",
    "OUTPUT_JSON_SCHEMA",
    JSON.stringify(jsonSchemaFor(type)),
    "",
    "EXAMPLE_JSON_OUTPUT",
    JSON.stringify(EXAMPLES[type]),
    "",
    "Return the keys in the same order as EXAMPLE_JSON_OUTPUT and replace every example value.",
  ].join("\n");
  return JSON.stringify({
    max_tokens: 4096,
    messages: [
      { content: system, role: "system" },
      { content: buildUntrustedInput(request), role: "user" },
    ],
    model: DEEPSEEK_MODEL,
    response_format: { type: "json_object" },
    stream: true,
    temperature: 0,
    thinking: { type: "disabled" },
  });
}
