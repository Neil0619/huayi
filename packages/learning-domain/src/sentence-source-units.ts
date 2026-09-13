import { z } from "zod/v3";
import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";
import { checkSourceUnitSequence } from "./teaching-source-checks.js";
import { partitionSentenceSource } from "./sentence-source-partition.js";

import { sentenceSourceUnitSchema, type SentenceSourceUnit } from "./teaching-shapes.js";
export { sentenceSourceUnitSchema, type SentenceSourceUnit } from "./teaching-shapes.js";
const sourceTextSchema = z.string().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH).regex(/\S/u);

function invalid(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: "custom", path, message }]);
}

export function segmentSentenceSource(sourceText: string): SentenceSourceUnit[] {
  return partitionSentenceSource(sourceTextSchema.parse(sourceText), invalid);
}

/** Only whitespace outside units may be skipped; the complete source must remain accounted for. */
export function validateSentenceSourceUnits(
  sourceText: string,
  units: unknown,
): SentenceSourceUnit[] {
  const source = sourceTextSchema.parse(sourceText);
  const parsed = z.array(sentenceSourceUnitSchema).min(1).max(40).parse(units);
  checkSourceUnitSequence(source, parsed, invalid);
  return parsed;
}
