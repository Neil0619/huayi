import { createHash } from "node:crypto";
import { z } from "zod/v3";
import {
  assembleLearningRecommendations,
  assembleSentenceStructure,
  candidateSchema,
  completeExpressionSourceRefs,
  completePatternSourceRefs,
  learningAdviceSchema,
  normalizeWhitespaceAndQuotes,
  phraseAnalysisSchema,
  sentencePassageAnalysisSchema,
  sentenceStructureDraftSchema,
  sourceBackedPattern,
  sourceBackedPatternSchema,
  structuredAnalysisContentSchema,
  validateSentenceSourceUnits,
  type ModelUsage,
  type RecommendationCandidate,
  type StartAnalysisGenerationRequest,
} from "@huayi/cloud-contracts";
import type { SegmentedSentence } from "./analysis-ports.js";
import { DEEPSEEK_PLATFORM_MODEL } from "./deepseek-model-identity.js";
import {
  analysisJsonErrorOffset,
  reportDeepSeekAnalysisOutputInvalid,
  type AnalysisRepairFeedback,
  type AnalysisValidationAttempt,
  type AnalysisValidationStage,
} from "./deepseek-analysis-diagnostics.js";

import { PLATFORM_STRUCTURED_ANALYSIS_PROMPT_VERSION as STRUCTURED_ANALYSIS_PROMPT_VERSION } from "@huayi/cloud-contracts";
export { STRUCTURED_ANALYSIS_PROMPT_VERSION };
const advice = { learningAdvice: learningAdviceSchema.optional() };
const expression = candidateSchema.options[0].shape.payload.extend(advice);
const pattern = sourceBackedPatternSchema.extend(advice);
const legacySentence = sentencePassageAnalysisSchema.innerType();
const sentence = legacySentence.shape.sentences.element
  .omit({
    analysisUnitId: true,
    candidateIds: true,
    ordinal: true,
    sourceText: true,
    structure: true,
  })
  .extend({
    sentenceStructure: sentenceStructureDraftSchema,
    candidates: z.array(z.union([expression, pattern])).max(20),
  });
const passage = z.strictObject({
  overall: legacySentence.shape.overall,
  sentences: z.array(sentence).min(1).max(40),
});
const phrase = phraseAnalysisSchema
  .innerType()
  .omit({ analysisUnitId: true, candidateIds: true, type: true })
  .extend({ candidates: z.array(expression).max(20) });

export function privateStructuredAnalysisSchema(
  kind: StartAnalysisGenerationRequest["selectionKind"],
) {
  return z.strictObject({
    previewZh: z.string().trim().min(1).max(1000),
    result: kind === "phrase" ? phrase : passage,
  });
}

function at<T>(path: (string | number)[], operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    throw new z.ZodError(
      error.issues.map((issue) => ({ ...issue, path: [...path, ...issue.path] })),
    );
  }
}

function collectCandidateIssue(issues: z.ZodIssue[], operation: () => string): string {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    issues.push(...error.issues);
    return ""; // No partially assembled content escapes: all collected issues are thrown below.
  }
}

/** Strict native assembly; complete candidate evidence only from its trusted source unit. */
export function readStructuredAnalysisContent(
  rawContent: string,
  input: StartAnalysisGenerationRequest,
  units: readonly SegmentedSentence[],
  usage: ModelUsage,
  attempt: AnalysisValidationAttempt,
): { content: unknown; feedback?: never } | { content?: never; feedback: AnalysisRepairFeedback } {
  let value: unknown;
  try {
    value = JSON.parse(rawContent);
  } catch (error) {
    const feedback = reportDeepSeekAnalysisOutputInvalid("json", attempt);
    const offset = analysisJsonErrorOffset(error, rawContent.length);
    return {
      feedback: { ...feedback, ...(offset === undefined ? {} : { jsonErrorOffset: offset }) },
    };
  }
  let stage: AnalysisValidationStage = "output-schema";
  try {
    const parsed = privateStructuredAnalysisSchema(input.selectionKind).parse(value);
    const rows = "sentences" in parsed.result ? parsed.result.sentences : [parsed.result];
    if (rows.length !== units.length)
      return { feedback: reportDeepSeekAnalysisOutputInvalid("unit-count", attempt) };
    stage = "content-schema";
    if (input.selectionKind !== "phrase") validateSentenceSourceUnits(input.sourceText, units);
    const entries: RecommendationCandidate[] = [];
    const candidateIssues: z.ZodIssue[] = [];
    const mapped = rows.map((row, index) => {
      const unit = units[index];
      if (!unit) throw new Error("Missing trusted source unit.");
      const base = "usageNotes" in row ? ["result"] : ["result", "sentences", index];
      const candidateIds = row.candidates.map((item, candidateIndex) =>
        collectCandidateIssue(candidateIssues, () =>
          at([...base, "candidates", candidateIndex], () => {
            const { learningAdvice, ...raw } = item;
            const payload =
              raw.type === "expression"
                ? raw
                : (() => {
                    const checked = sourceBackedPattern(raw, unit.sourceText);
                    if (checked.issues) throw new z.ZodError(checked.issues);
                    return checked.payload;
                  })();
            const ordinal = entries.length,
              id = `c${ordinal + 1}`;
            const candidate = candidateSchema.parse({
              id,
              ordinal,
              analysisUnitId: unit.analysisUnitId,
              type: payload.type === "expression" ? "expression" : "sentence-pattern",
              payload,
            });
            const entry: RecommendationCandidate = {
              candidate,
              ...(learningAdvice === undefined
                ? {}
                : {
                    advice: {
                      ...learningAdvice,
                      sourceRefs: at(["learningAdvice", "sourceRefs"], () =>
                        payload.type === "expression"
                          ? completeExpressionSourceRefs(
                              unit.sourceText,
                              payload.text,
                              learningAdvice.sourceRefs,
                            )
                          : completePatternSourceRefs(
                              unit.sourceText,
                              payload,
                              raw.type === "sentence_pattern" ? raw.sourceValues : undefined,
                              learningAdvice.sourceRefs,
                            ),
                      ),
                    },
                  }),
              ...(raw.type === "sentence_pattern" ? { sourceValues: raw.sourceValues } : {}),
            };
            // Validate advice at its private input location before aggregate checks reorder it.
            if (learningAdvice !== undefined) {
              at(["learningAdvice"], () =>
                assembleLearningRecommendations(
                  [{ analysisUnitId: unit.analysisUnitId, sourceText: unit.sourceText }],
                  [entry],
                ),
              );
            }
            entries.push(entry);
            return id;
          }),
        ),
      );
      const { candidates, ...teaching } = row;
      void candidates;
      return "sentenceStructure" in teaching
        ? {
            ...teaching,
            ...unit,
            candidateIds,
            sentenceStructure: at([...base, "sentenceStructure"], () =>
              assembleSentenceStructure(unit.sourceText, teaching.sentenceStructure),
            ),
          }
        : { ...teaching, analysisUnitId: "u1", candidateIds, type: "phrase-analysis-v3" };
    });
    if (candidateIssues.length > 0) throw new z.ZodError(candidateIssues);
    const recommendations = at(["result", "recommendations"], () =>
      assembleLearningRecommendations(
        units.map(({ analysisUnitId, sourceText }) => ({ analysisUnitId, sourceText })),
        entries,
      ),
    );
    const result =
      "sentences" in parsed.result
        ? {
            type: "sentence-passage-analysis-v3",
            overall: parsed.result.overall,
            sentences: mapped,
            recommendations,
          }
        : { ...mapped[0], recommendations };
    return {
      content: structuredAnalysisContentSchema.parse({
        candidates: entries.map((entry) => entry.candidate),
        result,
        sourceText: input.sourceText,
        selectionKind: input.selectionKind,
        source: input.source,
        sourceNormalizedHash: createHash("sha256")
          .update(normalizeWhitespaceAndQuotes(input.sourceText))
          .digest("hex"),
        modelMetadata: {
          provider: "deepseek",
          model: DEEPSEEK_PLATFORM_MODEL,
          promptVersion: STRUCTURED_ANALYSIS_PROMPT_VERSION,
          schemaVersion: 3,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
      }),
    };
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return { feedback: reportDeepSeekAnalysisOutputInvalid(stage, attempt, error.issues) };
  }
}
