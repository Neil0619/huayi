import {
  checkSentenceUnitForSource,
  checkSentenceExplanationSource,
} from "./sentence-explanation-source.js";
import { z } from "zod/v3";
import { sentenceExplanationResultSchema } from "./analysis-results.js";
import { segmentSentenceSource } from "./sentence-source-units.js";
import { assembleSentenceStructure, sentenceStructureDraftSchema } from "./teaching-structure.js";
import {
  structuredSentenceUnitSchema,
  type StructuredSentenceUnit,
} from "./structured-sentence-unit.js";
import {
  sentenceExplanationV2ResultSchema,
  type SentenceExplanationV2Result,
} from "./structured-store-results.js";

/** Provider-private drafts cannot supply source text, positions, unit IDs or request identity. */
export const sentenceExplanationDraftSchema = sentenceExplanationResultSchema
  .omit({ mainStructure: true, requestId: true, sourceText: true, type: true, selectionKind: true })
  .extend({ sentenceStructures: z.array(sentenceStructureDraftSchema).min(1).max(40) });

function invalid(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: "custom", path, message }]);
}

export function assembleSentenceExplanationUnit(
  sourceText: string,
  ordinal: number,
  draft: unknown,
): StructuredSentenceUnit {
  const unit = segmentSentenceSource(sourceText)[ordinal];
  if (!unit) return invalid(["sentenceStructures", ordinal], "Unknown source unit.");
  return structuredSentenceUnitSchema.parse({
    ...unit,
    sentenceStructure: assembleSentenceStructure(unit.sourceText, draft),
  });
}

export function validateSentenceUnitForSource(
  sourceText: string,
  value: StructuredSentenceUnit,
): void {
  checkSentenceUnitForSource(sourceText, structuredSentenceUnitSchema.parse(value), invalid);
}
export function validateSentenceExplanationSource(
  result: SentenceExplanationV2Result,
  sourceText: string,
): void {
  checkSentenceExplanationSource(result, sourceText, invalid);
}

export function assembleSentenceExplanationResult(
  value: unknown,
  input: { sourceText: string; requestId: string; selectionKind: string },
): SentenceExplanationV2Result {
  const parsed = sentenceExplanationDraftSchema.parse(value);
  const units = segmentSentenceSource(input.sourceText);
  if (units.length !== parsed.sentenceStructures.length)
    invalid(["sentenceStructures"], "Exactly one structure per trusted source unit is required.");
  parsed.keyExpressions.forEach((expression, index) => {
    if (!input.sourceText.includes(expression.text))
      invalid(["keyExpressions", index, "text"], "Exact source expression required.");
  });
  return sentenceExplanationV2ResultSchema.parse({
    ...parsed,
    type: "explain-sentence-v2",
    ...input,
    sentenceStructures: units.map((unit, index) => ({
      ...unit,
      sentenceStructure: assembleSentenceStructure(
        unit.sourceText,
        parsed.sentenceStructures[index],
      ),
    })),
  });
}

export const sentenceExplanationGenerationInstructions = [
  "Return sentenceStructures in the supplied unit order, exactly one structure for each unit. Never return type, selectionKind, requestId, unit IDs, ordinals, sourceText or start/end offsets.",
  "Each structure has kind sentence or fragment. Explain the main clauses separately from modifiers, each with precise relation and an existing acyclic target. Groups may be discontiguous or nested, but never cross source ranges.",
  "Each fragment is {text,occurrence}: exact text in that source unit and one-based occurrence, including overlapping matches. Preserve case, spaces, quotes and Unicode exactly. Do not turn separate fragments into one invented continuous quote.",
  "keyExpressions.text must be an exact fragment of the complete source. All explanations use concise Simplified Chinese. Preserve negation, qualifiers and uncertainty; do not infer events or causal relations that are absent from the source.",
  "Keep the response under 12000 characters where practical, at most 20000. Keep all source units and required fields; optional arrays may be empty.",
].join("\n");
