import { SCHEMA_VERSION } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest, HostEvent, PartOfSpeech } from "@huayi/protocol";

const sparseReportedWords: Readonly<Record<string, PartOfSpeech>> = {
  Four: "number",
  accountable: "adjective",
  sustained: "adjective",
  victims: "noun",
};

function lexicalTranslation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "word" && request.selectionKind !== "phrase") {
    throw new Error("Lexical translation requires a word or phrase.");
  }

  const reportedPartOfSpeech = sparseReportedWords[request.selection];
  if (reportedPartOfSpeech !== undefined) {
    return {
      collocations: [],
      contextualMeaningZh: "词汇翻译结果",
      partOfSpeech: reportedPartOfSpeech,
      selectionKind: request.selectionKind,
      similarTerms: [],
      sourceText: request.selection,
      type: "translate-lexical",
    };
  }

  return {
    collocations: [
      { meaningZh: "测试搭配一", text: "sample collocation" },
      { meaningZh: "测试搭配二", text: "common collocation" },
      { meaningZh: "测试搭配三", text: "useful collocation" },
    ],
    contextualMeaningZh: "词汇翻译结果",
    partOfSpeech: request.selectionKind === "word" ? "noun" : "phrase",
    pronunciation: { uk: "/mock/", us: "/mock/" },
    selectionKind: request.selectionKind,
    similarTerms: [
      { meaningZh: "相近表达一", partOfSpeech: "noun", text: "alternative" },
      { meaningZh: "相近表达二", partOfSpeech: "noun", text: "equivalent" },
      { meaningZh: "相近表达三", partOfSpeech: "noun", text: "counterpart" },
    ],
    sourceText: request.selection,
    type: "translate-lexical",
  };
}

function passageTranslation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "sentence" && request.selectionKind !== "paragraph") {
    throw new Error("Passage translation requires a sentence or paragraph.");
  }

  return {
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    translationZh: "段落翻译结果",
    type: "translate-passage",
  };
}

function lexicalExplanation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "word" && request.selectionKind !== "phrase") {
    throw new Error("Lexical explanation requires a word or phrase.");
  }

  const reportedPartOfSpeech = sparseReportedWords[request.selection];
  if (reportedPartOfSpeech !== undefined) {
    return {
      collocations: [],
      contextualMeaningZh: "词汇解释结果",
      coreMeanings: [{ meaningZh: "核心词义", partOfSpeech: reportedPartOfSpeech }],
      selectionKind: request.selectionKind,
      sourceText: request.selection,
      synonyms: [],
      type: "explain-lexical",
    };
  }

  return {
    baseForm: "sustain",
    collocations: [
      { meaningZh: "测试搭配一", text: "sample collocation" },
      { meaningZh: "测试搭配二", text: "common collocation" },
    ],
    contextualMeaningZh: "词汇解释结果",
    coreMeanings: [{ meaningZh: "核心词义", partOfSpeech: "verb" }],
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    synonyms: [
      { meaningZh: "同义表达一", partOfSpeech: "adjective", text: "continuous" },
      { meaningZh: "同义表达二", partOfSpeech: "adjective", text: "prolonged" },
      { meaningZh: "同义表达三", partOfSpeech: "adjective", text: "uninterrupted" },
    ],
    type: "explain-lexical",
    wordFormation: "模拟构词说明",
  };
}

function sentenceExplanation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "sentence") {
    throw new Error("Sentence explanation requires a sentence.");
  }

  return {
    contextRole: "说明这句话在上下文中的语境作用。",
    keyExpressions: [{ meaningZh: "关键表达含义", text: "in its early stages" }],
    mainStructure: "句子解释主干",
    selectionKind: "sentence",
    sourceText: request.selection,
    translationZh: "句子解释译文",
    type: "explain-sentence",
  };
}

function resultFor(request: AnalyzeRequest): AnalysisResult {
  if (request.action === "translate") {
    return request.selectionKind === "word" || request.selectionKind === "phrase"
      ? lexicalTranslation(request)
      : passageTranslation(request);
  }

  return request.selectionKind === "sentence"
    ? sentenceExplanation(request)
    : lexicalExplanation(request);
}

export function createResultEvent(request: AnalyzeRequest): HostEvent {
  return {
    requestId: request.requestId,
    result: resultFor(request),
    schemaVersion: SCHEMA_VERSION,
    type: "result",
  };
}

export function createSectionEvent(request: AnalyzeRequest, sequence: number): HostEvent | null {
  const result = resultFor(request);
  if (result.type === "translate-lexical") {
    return {
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      section: "part-of-speech",
      sequence,
      type: "analysis-section",
      value: result.partOfSpeech,
    };
  }
  if (result.type === "explain-lexical") {
    return {
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      section: "core-meanings",
      sequence,
      type: "analysis-section",
      value: result.coreMeanings,
    };
  }
  return null;
}
