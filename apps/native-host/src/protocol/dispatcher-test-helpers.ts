import type {
  AddWordRequest,
  AnalysisResult,
  AnalyzeRequest,
  CheckWordRequest,
  HostEvent,
  WarmupRequest,
} from "@huayi/protocol";

export const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 2,
  selection: "investigation",
  selectionKind: "word",
  sentenceContext: null,
  targetLanguage: "zh-CN",
  type: "analyze",
};

export const validResult: AnalysisResult = {
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
};

export const checkRequest: CheckWordRequest = {
  language: "en",
  requestId: "check-1",
  schemaVersion: 2,
  type: "check-word",
  word: "investigation",
};

export const warmupRequest: WarmupRequest = {
  requestId: "warmup-1",
  schemaVersion: 2,
  type: "warmup",
};

export const wordRequest: AddWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 2,
  type: "add-word",
  word: "investigation",
};

export function eventsFor(events: HostEvent[], requestId: string): HostEvent[] {
  return events.filter((event) => event.requestId === requestId);
}

export function waitForAbort(signal: AbortSignal): Promise<AnalysisResult> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
