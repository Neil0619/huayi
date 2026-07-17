import type { AnalyzeRequest } from "@huayi/protocol";

import type { ModelResultType } from "./model-analysis-schemas.js";
import type { ModelOutputSchema } from "./model-schema-repository.js";
import { buildAnalysisSystemInstructions, buildUntrustedWebpageMessage } from "./prompt-builder.js";

export const DEEPSEEK_MODEL = "deepseek-v4-flash" as const;

export interface DeepSeekChatRequest {
  readonly analysisRequest: AnalyzeRequest;
  readonly outputSchema: ModelOutputSchema;
  readonly resultType: ModelResultType;
}

const EXAMPLES = {
  "explain-word": {
    contextualAnalysisZh: "说明此处含义、取义原因和语境作用。",
    wordForm: {
      baseForm: "example",
      formTypeZh: "原形",
      sentenceRoleZh: null,
    },
    wordFormationZh: null,
    usageNotes: [],
    synonyms: [],
  },
  "explain-lexical": {
    contextualMeaningZh: "语境中的中文释义",
    baseForm: null,
    wordFormation: null,
    coreMeanings: [{ meaningZh: "核心中文义", partOfSpeech: "noun" }],
    collocations: [],
    synonyms: [],
  },
  "explain-sentence": {
    mainStructure: "主语、谓语和其他主要成分",
    keyExpressions: [{ meaningZh: "中文含义", text: "English expression" }],
    translationZh: "完整中文翻译。",
    contextRole: "该句在上下文中的作用。",
  },
  "translate-lexical": {
    contextualMeaningZh: "语境中的中文义",
    partOfSpeech: "noun",
    pronunciation: null,
    collocations: [],
    contextExampleTranslationZh: null,
    similarTerms: [],
  },
  "translate-passage": { translationZh: "完整中文翻译。" },
  "translate-word": {
    pronunciation: null,
    contextualSense: { meaningZh: "语境中的中文义", partOfSpeech: "noun" },
    dictionaryForm: "example",
    commonMeanings: [{ meaningsZh: ["常用中文义"], partOfSpeech: "noun" }],
    commonPhrases: [],
    confusableWords: [],
  },
} as const satisfies Record<ModelResultType, object>;

function systemMessage(request: DeepSeekChatRequest): string {
  return [
    buildAnalysisSystemInstructions(request.analysisRequest),
    "",
    "OUTPUT_JSON_SCHEMA",
    JSON.stringify(request.outputSchema),
    "",
    "EXAMPLE_JSON_OUTPUT",
    JSON.stringify(EXAMPLES[request.resultType]),
    "",
    "Return the keys in the same order as EXAMPLE_JSON_OUTPUT and replace every example value.",
  ].join("\n");
}

export function buildDeepSeekRequestBody(request: DeepSeekChatRequest): string {
  return JSON.stringify({
    max_tokens: 4096,
    messages: [
      { content: systemMessage(request), role: "system" },
      { content: buildUntrustedWebpageMessage(request.analysisRequest), role: "user" },
    ],
    model: DEEPSEEK_MODEL,
    response_format: { type: "json_object" },
    stream: true,
    temperature: 0,
    thinking: { type: "disabled" },
  });
}
