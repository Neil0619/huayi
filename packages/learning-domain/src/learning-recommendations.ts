import { z } from "zod/v3";
import { candidateSchema, generatedExampleSchema, type Candidate } from "./domain-schemas.js";
import {
  patternSourceValuesSchema,
  renderPatternWithValues,
  sourcePatternFragment,
} from "./pattern-source.js";
import {
  resolveSourceFragments,
  sourceFragmentReferenceSchema,
  sourceSpanSchema,
  validateSourceSpans,
  type SourceFragmentReference,
  type SourceSpan,
} from "./source-fragments.js";

const zhText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/[\u3400-\u9fff]/u);
export const learningAdviceSchema = z.strictObject({
  priority: z.number().int().min(1).max(3),
  sourceRefs: z.array(sourceFragmentReferenceSchema).min(1).max(8),
  useWhenZh: zhText,
  reasonZh: zhText,
  generatedExample: generatedExampleSchema,
  exampleValues: patternSourceValuesSchema.optional(),
});
export const learningRecommendationSchema = z.strictObject({
  candidateId: candidateSchema.options[0].shape.id,
  sourceEvidence: z.array(sourceSpanSchema).min(1).max(8),
  useWhenZh: zhText,
  reasonZh: zhText,
  generatedExample: generatedExampleSchema,
});
export type LearningRecommendation = z.infer<typeof learningRecommendationSchema>;
export interface RecommendationSourceUnit {
  readonly analysisUnitId: string;
  readonly sourceText: string;
}
export interface RecommendationCandidate {
  readonly candidate: Candidate;
  readonly advice?: unknown;
  readonly sourceValues?: unknown;
}

const unitsSchema = z
  .array(
    z.strictObject({
      analysisUnitId: candidateSchema.options[0].shape.analysisUnitId,
      sourceText: z.string().min(1).max(2000).regex(/\S/u),
    }),
  )
  .min(1)
  .max(40);
const recommendationsSchema = z.array(learningRecommendationSchema).max(3);
function invalid(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: "custom", path, message }]);
}
function contextFor(units: readonly RecommendationSourceUnit[], candidates: readonly Candidate[]) {
  const sources = unitsSchema.parse(units);
  const checked = z.array(candidateSchema).max(200).parse(candidates);
  const sourceById = new Map(sources.map((unit) => [unit.analysisUnitId, unit.sourceText]));
  const candidateById = new Map(checked.map((candidate) => [candidate.id, candidate]));
  if (sourceById.size !== sources.length) invalid(["units"], "Source unit ids must be unique.");
  if (candidateById.size !== checked.length)
    invalid(["candidates"], "Candidate ids must be unique.");
  for (const candidate of checked)
    if (!sourceById.has(candidate.analysisUnitId))
      invalid(["candidates"], "Every candidate must belong to an existing source unit.");
  return { sourceById, candidateById, candidates: checked };
}

/** Require a complete literal expression inside the evidence, with boundaries in the full source. */
function containsExpression(
  text: string,
  expression: string,
  start = 0,
  end = text.length,
): boolean {
  let index = text.indexOf(expression, start);
  while (index >= 0 && index + expression.length <= end) {
    const before = text.slice(0, index);
    const after = text.slice(index + expression.length);
    if (
      (!/^[\p{L}\p{N}\p{M}_]/u.test(expression) || !/[\p{L}\p{N}\p{M}_]$/u.test(before)) &&
      (!/[\p{L}\p{N}\p{M}_]$/u.test(expression) || !/^[\p{L}\p{N}\p{M}_]/u.test(after))
    )
      return true;
    index = text.indexOf(expression, index + 1);
  }
  return false;
}

/** Complete private expression evidence from its own source; never rescue invalid references. */
export function completeExpressionSourceRefs(
  source: string,
  expression: string,
  sourceRefs: unknown,
): SourceFragmentReference[] {
  const text = candidateSchema.options[0].shape.payload.shape.text.parse(expression);
  const references = learningAdviceSchema.shape.sourceRefs.parse(sourceRefs);
  const spans = resolveSourceFragments(source, references);
  if (spans.some((span) => containsExpression(source, text, span.start, span.end)))
    return references;
  let occurrence = 0;
  let start = source.indexOf(text);
  while (start >= 0) {
    occurrence += 1;
    if (containsExpression(source, text, start, start + text.length)) return [{ text, occurrence }];
    start = source.indexOf(text, start + 1);
  }
  return invalid([], "Evidence must contain the candidate expression in its own source unit.");
}

function checkExpression(
  candidate: Candidate,
  source: string,
  evidence: SourceSpan[],
  example: string,
): void {
  if (candidate.payload.type !== "expression") return;
  const text = candidate.payload.text;
  if (!evidence.some((span) => containsExpression(source, text, span.start, span.end)))
    invalid(
      ["sourceEvidence"],
      "Evidence must contain the candidate expression in its own source unit.",
    );
  if (!containsExpression(example, text))
    invalid(["generatedExample"], "The example must use the candidate expression.");
}

export function assembleLearningRecommendations(
  units: readonly RecommendationSourceUnit[],
  candidates: readonly RecommendationCandidate[],
): LearningRecommendation[] {
  const context = contextFor(
    units,
    candidates.map((entry) => entry.candidate),
  );
  const priorities = new Set<number>();
  const assembled = candidates.flatMap((entry, index) => {
    if (entry.advice === undefined) return [];
    const advice = learningAdviceSchema.parse(entry.advice);
    if (priorities.has(advice.priority))
      invalid(["priority"], "Recommendation priorities must be unique globally.");
    priorities.add(advice.priority);
    const candidate = context.candidates[index];
    if (!candidate) return invalid(["candidates", index], "Missing trusted candidate.");
    const source = context.sourceById.get(candidate.analysisUnitId);
    if (source === undefined) return invalid(["candidates", index], "Missing trusted source unit.");
    const sourceEvidence = resolveSourceFragments(source, advice.sourceRefs);
    checkExpression(candidate, source, sourceEvidence, advice.generatedExample.sourceText);
    if (candidate.payload.type === "sentence_pattern") {
      const rendered = renderPatternWithValues(candidate.payload, entry.sourceValues);
      if (
        !sourceEvidence.some(
          (span) =>
            span.text.includes(rendered) ||
            (span.end === source.length &&
              sourcePatternFragment(rendered, span.text) !== undefined),
        )
      )
        invalid(["sourceRefs"], "Evidence must include the exact reconstructed sentence pattern.");
      if (
        renderPatternWithValues(candidate.payload, advice.exampleValues) !==
        advice.generatedExample.sourceText
      )
        invalid(
          ["generatedExample"],
          "Example values must reconstruct the complete example exactly.",
        );
    } else if (entry.sourceValues !== undefined || advice.exampleValues !== undefined) {
      invalid(["exampleValues"], "Expression advice must not provide sentence-pattern values.");
    }
    return [
      {
        priority: advice.priority,
        recommendation: {
          candidateId: candidate.id,
          sourceEvidence,
          useWhenZh: advice.useWhenZh,
          reasonZh: advice.reasonZh,
          generatedExample: advice.generatedExample,
        },
      },
    ];
  });
  return recommendationsSchema.parse(
    assembled
      .sort((left, right) => left.priority - right.priority)
      .map((entry) => entry.recommendation),
  );
}

/** Recheck public source evidence and ownership. Private pattern/example witnesses are checked at assembly. */
export function validateLearningRecommendationSources(
  units: readonly RecommendationSourceUnit[],
  candidates: readonly Candidate[],
  recommendations: unknown,
): LearningRecommendation[] {
  const context = contextFor(units, candidates);
  const parsed = recommendationsSchema.parse(recommendations);
  const ids = new Set<string>();
  for (const [index, recommendation] of parsed.entries()) {
    if (ids.has(recommendation.candidateId))
      invalid([index, "candidateId"], "Each candidate may be recommended once.");
    ids.add(recommendation.candidateId);
    const candidate = context.candidateById.get(recommendation.candidateId);
    if (!candidate)
      invalid([index, "candidateId"], "Recommendation must reference an existing candidate.");
    const source = context.sourceById.get(candidate.analysisUnitId);
    if (source === undefined) invalid([index, "candidateId"], "Missing trusted source unit.");
    validateSourceSpans(source, recommendation.sourceEvidence);
    checkExpression(
      candidate,
      source,
      recommendation.sourceEvidence,
      recommendation.generatedExample.sourceText,
    );
  }
  return parsed;
}
