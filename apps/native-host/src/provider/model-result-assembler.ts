import { MAX_MEANINGS_PER_GROUP, analysisResultSchema } from "@huayi/protocol";
import type {
  AnalysisResult,
  AnalyzeRequest,
  DictionaryMeaningGroup,
  Pronunciation,
} from "@huayi/protocol";
import type { ZodError, ZodType } from "zod";

import {
  modelLexicalExplanationSchema,
  modelLexicalTranslationSchema,
  modelPassageTranslationSchema,
  modelSentenceExplanationSchema,
  modelWordExplanationSchema,
  modelWordTranslationSchema,
  resultTypeFor,
  type ModelLexicalExplanation,
  type ModelLexicalTranslation,
  type ModelPassageTranslation,
  type ModelResultType,
  type ModelSentenceExplanation,
  type ModelWordExplanation,
  type ModelWordTranslation,
} from "./model-analysis-schemas.js";
import { ProviderValidationError, providerDiagnosticField } from "./provider-validation.js";

function firstDiagnosticField(error: ZodError): unknown {
  return error.issues[0]?.path[0];
}

function parseJson(finalText: string): unknown {
  try {
    return JSON.parse(finalText);
  } catch (cause) {
    throw new ProviderValidationError("model-json", { cause });
  }
}

function parseModelContent<Content>(schema: ZodType<Content>, rawResult: unknown): Content {
  const parsed = schema.safeParse(rawResult);
  if (!parsed.success) {
    throw new ProviderValidationError("model-schema", {
      cause: parsed.error,
      field: firstDiagnosticField(parsed.error),
    });
  }
  return parsed.data;
}

function normalizePronunciation(
  pronunciation: ModelLexicalTranslation["pronunciation"] | ModelWordTranslation["pronunciation"],
): Pronunciation | undefined {
  if (pronunciation === null) return undefined;
  const normalized: Pronunciation = {
    ...(pronunciation.uk === null ? {} : { uk: pronunciation.uk }),
    ...(pronunciation.us === null ? {} : { us: pronunciation.us }),
  };
  return normalized.uk === undefined && normalized.us === undefined ? undefined : normalized;
}

function mergeDictionaryMeaningGroups(
  groups: ModelWordTranslation["commonMeanings"],
): DictionaryMeaningGroup[] {
  const merged: DictionaryMeaningGroup[] = [];
  const indexesByPartOfSpeech = new Map<DictionaryMeaningGroup["partOfSpeech"], number>();

  for (const group of groups) {
    const existingIndex = indexesByPartOfSpeech.get(group.partOfSpeech);
    if (existingIndex === undefined) {
      indexesByPartOfSpeech.set(group.partOfSpeech, merged.length);
      merged.push({ meaningsZh: [...group.meaningsZh], partOfSpeech: group.partOfSpeech });
      continue;
    }

    const existing = merged[existingIndex];
    if (existing === undefined) {
      continue;
    }
    const meanings = [...existing.meaningsZh];
    const seen = new Set(meanings);
    for (const meaning of group.meaningsZh) {
      if (meanings.length >= MAX_MEANINGS_PER_GROUP) {
        break;
      }
      if (!seen.has(meaning)) {
        seen.add(meaning);
        meanings.push(meaning);
      }
    }
    merged[existingIndex] = { meaningsZh: meanings, partOfSpeech: existing.partOfSpeech };
  }

  return merged;
}

function assembleWordTranslation(content: ModelWordTranslation, request: AnalyzeRequest): unknown {
  const pronunciation = normalizePronunciation(content.pronunciation);
  return {
    commonMeanings: mergeDictionaryMeaningGroups(content.commonMeanings),
    commonPhrases: content.commonPhrases,
    confusableWords: content.confusableWords,
    contextualSense: content.contextualSense,
    dictionaryForm: content.dictionaryForm,
    ...(pronunciation === undefined ? {} : { pronunciation }),
    selectionKind: "word",
    sourceText: request.selection,
    type: "translate-word",
  };
}

function assembleLexicalTranslation(
  content: ModelLexicalTranslation,
  request: AnalyzeRequest,
): unknown {
  const pronunciation = normalizePronunciation(content.pronunciation);
  let contextExample: { english: string; translationZh: string } | undefined;
  if (content.contextExampleTranslationZh !== null) {
    if (request.sentenceContext === null) {
      throw new ProviderValidationError("result-assembly", {
        field: "contextExampleTranslationZh",
      });
    }
    contextExample = {
      english: request.sentenceContext,
      translationZh: content.contextExampleTranslationZh,
    };
  }

  return {
    collocations: content.collocations,
    ...(contextExample === undefined ? {} : { contextExample }),
    contextualMeaningZh: content.contextualMeaningZh,
    partOfSpeech: content.partOfSpeech,
    ...(pronunciation === undefined ? {} : { pronunciation }),
    selectionKind: request.selectionKind,
    similarTerms: content.similarTerms,
    sourceText: request.selection,
    type: "translate-lexical",
  };
}

function assembleLexicalExplanation(
  content: ModelLexicalExplanation,
  request: AnalyzeRequest,
): unknown {
  return {
    ...(content.baseForm === null ? {} : { baseForm: content.baseForm }),
    collocations: content.collocations,
    contextualMeaningZh: content.contextualMeaningZh,
    coreMeanings: content.coreMeanings,
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    synonyms: content.synonyms,
    type: "explain-lexical",
    ...(content.wordFormation === null ? {} : { wordFormation: content.wordFormation }),
  };
}

function assembleWordExplanation(content: ModelWordExplanation, request: AnalyzeRequest): unknown {
  return {
    contextualAnalysisZh: content.contextualAnalysisZh,
    selectionKind: "word",
    sourceText: request.selection,
    synonyms: content.synonyms,
    type: "explain-word",
    usageNotes: content.usageNotes,
    wordForm: {
      baseForm: content.wordForm.baseForm,
      formTypeZh: content.wordForm.formTypeZh,
      ...(content.wordForm.sentenceRoleZh === null
        ? {}
        : { sentenceRoleZh: content.wordForm.sentenceRoleZh }),
    },
    ...(content.wordFormationZh === null ? {} : { wordFormationZh: content.wordFormationZh }),
  };
}

function assemblePassageTranslation(
  content: ModelPassageTranslation,
  request: AnalyzeRequest,
): unknown {
  return {
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    translationZh: content.translationZh,
    type: "translate-passage",
  };
}

function assembleSentenceExplanation(
  content: ModelSentenceExplanation,
  request: AnalyzeRequest,
): unknown {
  return {
    contextRole: content.contextRole,
    keyExpressions: content.keyExpressions,
    mainStructure: content.mainStructure,
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    translationZh: content.translationZh,
    type: "explain-sentence",
  };
}

function resultTypeForAssembly(request: AnalyzeRequest): ModelResultType {
  try {
    return resultTypeFor(request);
  } catch (cause) {
    throw new ProviderValidationError("result-assembly", { cause });
  }
}

function assembleModelContent(
  rawResult: unknown,
  resultType: ModelResultType,
  request: AnalyzeRequest,
): unknown {
  switch (resultType) {
    case "translate-word":
      return assembleWordTranslation(
        parseModelContent(modelWordTranslationSchema, rawResult),
        request,
      );
    case "translate-lexical":
      return assembleLexicalTranslation(
        parseModelContent(modelLexicalTranslationSchema, rawResult),
        request,
      );
    case "translate-passage":
      return assemblePassageTranslation(
        parseModelContent(modelPassageTranslationSchema, rawResult),
        request,
      );
    case "explain-lexical":
      return assembleLexicalExplanation(
        parseModelContent(modelLexicalExplanationSchema, rawResult),
        request,
      );
    case "explain-word":
      return assembleWordExplanation(
        parseModelContent(modelWordExplanationSchema, rawResult),
        request,
      );
    case "explain-sentence":
      return assembleSentenceExplanation(
        parseModelContent(modelSentenceExplanationSchema, rawResult),
        request,
      );
  }
}

export function parseAndAssembleModelResult(
  finalText: string,
  request: AnalyzeRequest,
): AnalysisResult {
  const rawResult = parseJson(finalText);
  const resultType = resultTypeForAssembly(request);
  let assembled: unknown;
  try {
    assembled = assembleModelContent(rawResult, resultType, request);
  } catch (error) {
    if (error instanceof ProviderValidationError) throw error;
    throw new ProviderValidationError("result-assembly", { cause: error });
  }

  const parsed = analysisResultSchema.safeParse(assembled);
  if (!parsed.success) {
    throw new ProviderValidationError("protocol-validation", {
      cause: parsed.error,
      field: providerDiagnosticField(firstDiagnosticField(parsed.error)),
    });
  }
  return parsed.data;
}
