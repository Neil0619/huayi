import { z } from "zod/v3";
import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";
import { checkSourceSpans } from "./teaching-source-checks.js";

import {
  sourceFragmentReferenceSchema,
  sourceSpanSchema,
  type SourceSpan,
} from "./teaching-shapes.js";
export {
  sourceFragmentReferenceSchema,
  sourceSpanSchema,
  type SourceSpan,
  type SourceFragmentReference,
} from "./teaching-shapes.js";

const sourceSchema = z.string().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH).regex(/\S/u);
const referencesSchema = z.array(sourceFragmentReferenceSchema).min(1).max(12);
const spansSchema = z.array(sourceSpanSchema).min(1).max(12);

function invalid(index: number, message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: [index], message }]);
}

/** Occurrence counts every exact match from left to right, including overlapping matches. */
export function resolveSourceFragments(sourceText: string, references: unknown): SourceSpan[] {
  const source = sourceSchema.parse(sourceText);
  const parsed = referencesSchema.parse(references);
  const spans = parsed.map(({ text, occurrence }, index) => {
    let start = -1;
    for (let count = 0; count < occurrence; count += 1) {
      start = source.indexOf(text, start + 1);
      if (start === -1) invalid(index, "Fragment must match its exact source occurrence.");
    }
    return { text, start, end: start + text.length };
  });
  return validateSourceSpans(source, spans);
}

/** Revalidate persisted or received positions; schema shape alone never proves source fidelity. */
export function validateSourceSpans(sourceText: string, spans: unknown): SourceSpan[] {
  const source = sourceSchema.parse(sourceText);
  const parsed = spansSchema.parse(spans);
  checkSourceSpans(source, parsed, (path, message) => {
    throw new z.ZodError([{ code: "custom", path, message }]);
  });
  return parsed;
}
