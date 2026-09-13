import type { SentenceSourceUnit } from "./teaching-shapes.js";
import {
  checkSourceUnitSequence,
  sourceCheckFailure,
  type SourceCheckFailure,
} from "./teaching-source-checks.js";

const abbreviations = new Set([
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "e.g.",
  "i.e.",
  "vs.",
  "jr.",
  "sr.",
  "st.",
]);
/** Deterministic source partition, not a claim of linguistic certainty at ambiguous abbreviations. */
export function partitionSentenceSource(
  source: string,
  invalid: SourceCheckFailure = sourceCheckFailure,
): SentenceSourceUnit[] {
  if (typeof source !== "string" || source.length > 2000 || !/\S/u.test(source))
    invalid([], "Invalid source text.");
  const values: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!/[.!?]/u.test(source[index] ?? "")) continue;
    let end = index + 1;
    while (/[.!?]/u.test(source[end] ?? "")) end += 1;
    const punctuationEnd = end;
    while (/["'”’\])}]/u.test(source[end] ?? "")) end += 1;
    if (end < source.length && !/\s/u.test(source[end] ?? "")) continue;
    const lastToken = source
      .slice(start, punctuationEnd)
      .trim()
      .split(/\s+/u)
      .at(-1)
      ?.toLowerCase();
    if (
      source[index] === "." &&
      lastToken !== undefined &&
      (abbreviations.has(lastToken) || /^(?:[a-z]\.)+$/u.test(lastToken))
    )
      continue;
    // A closing quote followed by a lowercase attribution stays with its sentence.
    if (end > punctuationEnd && /^[\s]+[a-z]/u.test(source.slice(end))) continue;
    const value = source.slice(start, end).trim();
    if (value) values.push(value);
    start = end;
    index = end - 1;
  }
  const tail = source.slice(start).trim();
  if (tail) values.push(tail);
  if (values.length < 1 || values.length > 40) invalid([], "Source requires one to forty units.");
  const units = values.map((sourceText, ordinal) => ({
    analysisUnitId: `u${ordinal + 1}`,
    ordinal,
    sourceText,
  }));
  checkSourceUnitSequence(source, units, invalid);
  return units;
}
