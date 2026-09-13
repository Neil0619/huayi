import { z } from "zod/v3";
import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";

/** Wire shapes form the leaf shared by schema assembly and pure semantic validation. */
const literalText = z.string().min(1).max(500).regex(/\S/u);
export const sourceFragmentReferenceSchema = z.strictObject({
  text: literalText,
  occurrence: z.number().int().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH),
});
export type SourceFragmentReference = z.infer<typeof sourceFragmentReferenceSchema>;

/** Offsets address the unchanged source using JavaScript UTF-16 half-open intervals. */
export const sourceSpanSchema = z.strictObject({
  text: literalText,
  start: z
    .number()
    .int()
    .min(0)
    .max(MAX_CONTEXT_SENTENCE_LENGTH - 1),
  end: z.number().int().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH),
});
export type SourceSpan = z.infer<typeof sourceSpanSchema>;
const sourceTextSchema = z.string().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH).regex(/\S/u);
export const sentenceSourceUnitSchema = z.strictObject({
  analysisUnitId: z.string().regex(/^u(?:[1-9]|[1-3]\d|40)$/u),
  ordinal: z.number().int().min(0).max(39),
  sourceText: sourceTextSchema,
});
export type SentenceSourceUnit = z.infer<typeof sentenceSourceUnitSchema>;

const explanationZh = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/[\u3400-\u9fff]/u);
const kind = z.enum(["sentence", "fragment"]);
const target = z.strictObject({
  kind: z.enum(["core", "modifier"]),
  index: z.number().int().min(0).max(11),
});
const relation = z.enum([
  "relative-clause",
  "adverbial",
  "apposition",
  "parenthetical",
  "complement",
  "coordination",
  "other",
]);
const draftGroup = z.strictObject({
  fragments: z.array(sourceFragmentReferenceSchema).min(1).max(8),
  explanationZh,
});
const trustedGroup = z.strictObject({
  fragments: z.array(sourceSpanSchema).min(1).max(8),
  explanationZh,
});

/** Model-facing shape only. Assemble before using a draft as trusted teaching. */
export const sentenceStructureDraftSchema = z.strictObject({
  kind,
  coreClauses: z.array(draftGroup).min(1).max(8),
  modifiers: z.array(draftGroup.extend({ relation, target })).max(12),
});
export type SentenceStructureDraft = z.infer<typeof sentenceStructureDraftSchema>;

/** Transport shape only. Source fidelity and relationships require validation below. */
export const sentenceStructureSchema = z.strictObject({
  kind,
  coreClauses: z.array(trustedGroup).min(1).max(8),
  modifiers: z.array(trustedGroup.extend({ relation, target })).max(12),
});
export type SentenceStructure = z.infer<typeof sentenceStructureSchema>;
