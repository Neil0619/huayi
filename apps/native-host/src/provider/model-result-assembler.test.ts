import type { AnalyzeRequest } from "@huayi/protocol";
import { describe, expect, it } from "vitest";

import { parseAndAssembleModelResult } from "./model-result-assembler.js";
import { ProviderValidationError } from "./provider-validation.js";

function createRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    action: "translate",
    context: "Four victims were interviewed.",
    requestId: "analysis-assembly-1",
    schemaVersion: 5,
    selection: "Four",
    selectionKind: "phrase",
    sentenceContext: "Four victims were interviewed.",
    targetLanguage: "zh-CN",
    type: "analyze",
    ...overrides,
  };
}

function lexicalTranslation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    collocations: [],
    contextExampleTranslationZh: null,
    contextualMeaningZh: "语境义",
    partOfSpeech: "adjective",
    pronunciation: null,
    similarTerms: [],
    ...overrides,
  };
}

function lexicalExplanation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    baseForm: null,
    collocations: [],
    contextualMeaningZh: "语境义",
    coreMeanings: [{ meaningZh: "核心义", partOfSpeech: "noun" }],
    synonyms: [],
    wordFormation: null,
    ...overrides,
  };
}

function wordTranslation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
    commonPhrases: [],
    confusableWords: [],
    contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
    dictionaryForm: "investigation",
    pronunciation: null,
    ...overrides,
  };
}

function wordExplanation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contextualAnalysisZh: "此处表示正式调查，因为它作句子的主语。",
    synonyms: [],
    usageNotes: [],
    wordForm: { baseForm: "investigation", formTypeZh: "名词单数", sentenceRoleZh: "主语" },
    wordFormationZh: null,
    ...overrides,
  };
}

function captureValidationError(run: () => unknown): ProviderValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProviderValidationError) return error;
    throw error;
  }
  throw new Error("Expected a ProviderValidationError.");
}

describe("parseAndAssembleModelResult", () => {
  it("assembles the dedicated word translation and explanation contracts", () => {
    expect(
      parseAndAssembleModelResult(
        JSON.stringify(wordTranslation()),
        createRequest({ selection: "investigation", selectionKind: "word" }),
      ),
    ).toMatchObject({ dictionaryForm: "investigation", type: "translate-word" });

    expect(
      parseAndAssembleModelResult(
        JSON.stringify(wordExplanation()),
        createRequest({ action: "explain", selection: "investigation", selectionKind: "word" }),
      ),
    ).toMatchObject({
      contextualAnalysisZh: "此处表示正式调查，因为它作句子的主语。",
      type: "explain-word",
    });
  });

  it.each([
    {
      content: lexicalTranslation({
        contextualMeaningZh: "持续的",
        pronunciation: { uk: null, us: null },
      }),
      expected: { collocations: [], contextualMeaningZh: "持续的", similarTerms: [] },
      request: createRequest({ selection: "sustained" }),
      resultType: "translate-lexical",
    },
    {
      content: lexicalExplanation({
        baseForm: "victim",
        contextualMeaningZh: "受害者（复数）",
      }),
      expected: { baseForm: "victim", contextualMeaningZh: "受害者（复数）", synonyms: [] },
      request: createRequest({ action: "explain", selection: "victims" }),
      resultType: "explain-lexical",
    },
    {
      content: lexicalTranslation({
        contextExampleTranslationZh: "他要为自己的决定负责。",
        contextualMeaningZh: "负有责任的",
      }),
      expected: {
        contextExample: {
          english: "He is accountable for his decisions.",
          translationZh: "他要为自己的决定负责。",
        },
      },
      request: createRequest({
        context: "He is accountable for his decisions.",
        selection: "accountable",
        sentenceContext: "He is accountable for his decisions.",
      }),
      resultType: "translate-lexical",
    },
    {
      content: lexicalTranslation({ contextualMeaningZh: "数字四", partOfSpeech: "number" }),
      expected: { collocations: [], partOfSpeech: "number", similarTerms: [] },
      request: createRequest({ selection: "Four" }),
      resultType: "translate-lexical",
    },
  ] as const)(
    "assembles trusted metadata for $request.selection",
    ({ content, expected, request, resultType }) => {
      const result = parseAndAssembleModelResult(JSON.stringify(content), request);

      expect(result).toMatchObject({
        selectionKind: request.selectionKind,
        sourceText: request.selection,
        type: resultType,
        ...expected,
      });
    },
  );

  it("never accepts model-owned public metadata", () => {
    const error = captureValidationError(() =>
      parseAndAssembleModelResult(
        JSON.stringify({
          ...lexicalExplanation({ baseForm: "victim" }),
          selectionKind: "phrase",
          sourceText: "victim",
          type: "explain-lexical",
        }),
        createRequest({ action: "explain", selection: "victims" }),
      ),
    );

    expect(error).toMatchObject({ field: undefined, stage: "model-schema" });
  });

  it.each([
    [null, undefined],
    [{ uk: null, us: null }, undefined],
    [{ uk: "/səˈsteɪnd/", us: null }, { uk: "/səˈsteɪnd/" }],
    [{ uk: null, us: "/səˈsteɪnd/" }, { us: "/səˈsteɪnd/" }],
  ] as const)("normalizes nullable pronunciation %j", (pronunciation, expected) => {
    const result = parseAndAssembleModelResult(
      JSON.stringify(lexicalTranslation({ pronunciation })),
      createRequest({ selection: "sustained" }),
    );

    if (expected === undefined) expect(result).not.toHaveProperty("pronunciation");
    else expect(result).toHaveProperty("pronunciation", expected);
  });

  it("omits null lexical optionals instead of synthesizing empty values", () => {
    const result = parseAndAssembleModelResult(
      JSON.stringify(lexicalExplanation()),
      createRequest({ action: "explain", selection: "Four" }),
    );

    expect(result).not.toHaveProperty("baseForm");
    expect(result).not.toHaveProperty("wordFormation");
    expect(result).toMatchObject({ collocations: [], synonyms: [] });
  });

  it("uses only trusted sentence context as context-example English", () => {
    const request = createRequest({
      context: "Trusted sentence. Untrusted surrounding text.",
      selection: "Trusted",
      sentenceContext: "Trusted sentence.",
    });
    const result = parseAndAssembleModelResult(
      JSON.stringify(lexicalTranslation({ contextExampleTranslationZh: "可信句子的翻译。" })),
      request,
    );

    expect(result).toHaveProperty("contextExample", {
      english: request.sentenceContext,
      translationZh: "可信句子的翻译。",
    });
  });

  it("fails at result assembly when model translation lacks trusted sentence context", () => {
    const error = captureValidationError(() =>
      parseAndAssembleModelResult(
        JSON.stringify(lexicalTranslation({ contextExampleTranslationZh: "伪造例句。" })),
        createRequest({ sentenceContext: null }),
      ),
    );

    expect(error).toMatchObject({
      field: "contextExampleTranslationZh",
      stage: "result-assembly",
    });
  });

  it("keeps a null example translation absent even when sentence context exists", () => {
    const result = parseAndAssembleModelResult(
      JSON.stringify(lexicalTranslation()),
      createRequest(),
    );

    expect(result).not.toHaveProperty("contextExample");
  });

  it("classifies malformed JSON and private-schema failures as untrusted model failures", () => {
    expect(
      captureValidationError(() => parseAndAssembleModelResult("not json", createRequest())),
    ).toMatchObject({ stage: "model-json" });

    expect(
      captureValidationError(() =>
        parseAndAssembleModelResult(
          JSON.stringify(lexicalTranslation({ partOfSpeech: "secret-token" })),
          createRequest(),
        ),
      ),
    ).toMatchObject({ field: "partOfSpeech", stage: "model-schema" });
  });

  it("classifies an impossible assembled public value as protocol validation", () => {
    const error = captureValidationError(() =>
      parseAndAssembleModelResult(
        JSON.stringify(lexicalTranslation()),
        createRequest({ selection: "" }),
      ),
    );

    expect(error).toMatchObject({ field: undefined, stage: "protocol-validation" });
  });

  it.each([
    {
      content: { translationZh: "第一段。" },
      request: createRequest({
        context: "First paragraph.",
        selection: "First paragraph.",
        selectionKind: "paragraph",
        sentenceContext: null,
      }),
      type: "translate-passage",
    },
    {
      content: {
        contextRole: "说明结果。",
        keyExpressions: [{ meaningZh: "结束了", text: "It ended" }],
        mainStructure: "主语 + 谓语",
        translationZh: "它结束了。",
      },
      request: createRequest({
        action: "explain",
        context: "It ended.",
        selection: "It ended.",
        selectionKind: "sentence",
        sentenceContext: null,
      }),
      type: "explain-sentence",
    },
  ] as const)("assembles $type with request-owned metadata", ({ content, request, type }) => {
    expect(parseAndAssembleModelResult(JSON.stringify(content), request)).toMatchObject({
      selectionKind: request.selectionKind,
      sourceText: request.selection,
      type,
    });
  });
});
