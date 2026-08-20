import type {
  Candidate,
  ContextObservation,
  LearningItemContent,
  SourceExample,
} from "./domain-schemas.js";
import { canonicalKeyForContent } from "./normalization.js";

export interface ConfirmationSource {
  readonly analysisUnitId?: string;
  readonly analysisId?: string;
  readonly sourceText: string;
  readonly sourceTitle?: string;
  readonly sourceType: "manual" | "study-capture";
  readonly translationZh?: string;
}

export interface WordDraft {
  readonly canonicalKey: string;
  readonly contexts: readonly ContextObservation[];
  readonly headword: string;
  readonly notes?: string;
}

export interface LearningItemDraft {
  readonly canonicalKey: string;
  readonly content: LearningItemContent;
  readonly sourceExamples: readonly SourceExample[];
  readonly systemAttributes: readonly string[];
  readonly tags: readonly string[];
  readonly type: "expression" | "sentence-pattern";
}

export interface ConfirmationResult {
  readonly item: LearningItemDraft;
  readonly type: "learning-item";
}

function generatedId(prefix: string, candidateId: string): string {
  return `${prefix}:${candidateId}`;
}

export function confirmCandidate(
  candidate: Candidate,
  source: ConfirmationSource,
  confirmedAt: string,
): ConfirmationResult {
  void confirmedAt;
  const content = candidate.payload;
  return {
    item: {
      canonicalKey: canonicalKeyForContent(content),
      content,
      sourceExamples: [
        {
          analysisId: source.analysisId,
          id: generatedId("source", candidate.id),
          analysisUnitId: candidate.analysisUnitId,
          sourceText: source.sourceText,
          sourceTitle: source.sourceTitle,
          sourceType: source.sourceType,
          translationZh: source.translationZh,
        },
      ],
      systemAttributes: [],
      tags: [],
      type: candidate.type,
    },
    type: "learning-item",
  };
}

function appendUnique<T>(
  target: readonly T[],
  incoming: readonly T[],
  key: (value: T) => string,
): T[] {
  const seen = new Set(target.map(key));
  const additions = incoming.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return [...target, ...additions];
}

export function mergeLearningItems(
  target: LearningItemDraft,
  incoming: LearningItemDraft,
): LearningItemDraft {
  if (target.type !== incoming.type || target.canonicalKey !== incoming.canonicalKey) {
    throw new Error("Only exact duplicate learning items of the same type can be merged.");
  }
  return {
    ...target,
    sourceExamples: appendUnique(
      target.sourceExamples,
      incoming.sourceExamples,
      (source) => source.id,
    ),
    systemAttributes: appendUnique(
      target.systemAttributes,
      incoming.systemAttributes,
      (value) => value,
    ),
    tags: appendUnique(target.tags, incoming.tags, (value) => value),
  };
}

export function mergeWordEntries(target: WordDraft, incoming: WordDraft): WordDraft {
  if (target.canonicalKey !== incoming.canonicalKey) {
    throw new Error("Only exact duplicate word entries can be merged.");
  }
  return {
    ...target,
    contexts: appendUnique(target.contexts, incoming.contexts, (context) => context.id),
  };
}
