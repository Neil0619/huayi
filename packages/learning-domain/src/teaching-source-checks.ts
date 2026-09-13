import type { SourceSpan, SentenceStructure, SentenceSourceUnit } from "./teaching-shapes.js";
import { splitsSurrogatePair } from "./source-boundaries.js";

export type SourceCheckFailure = (path: (string | number)[], message: string) => never;
export const sourceCheckFailure: SourceCheckFailure = (_path, message) => {
  throw new TypeError(message);
};

/** Pure semantic checks shared by schema readers and lightweight page consumers. Shape must be parsed first. */
export function checkSourceSpans(
  source: string,
  spans: readonly SourceSpan[],
  invalid: SourceCheckFailure = sourceCheckFailure,
): void {
  let previousEnd = 0;
  spans.forEach((span, index) => {
    if (
      span.end <= span.start ||
      span.end > source.length ||
      source.slice(span.start, span.end) !== span.text ||
      splitsSurrogatePair(source, span.start) ||
      splitsSurrogatePair(source, span.end)
    )
      invalid([index], "Fragment position must match the unchanged source.");
    if (span.start < previousEnd)
      invalid([index], "Fragments must be ordered and non-overlapping.");
    previousEnd = span.end;
  });
}

function envelope(fragments: SourceSpan[], invalid: SourceCheckFailure) {
  const first = fragments[0];
  const last = fragments.at(-1);
  if (!first || !last) return invalid([], "A teaching group must contain source fragments.");
  return { start: first.start, end: last.end };
}

export function checkTeachingRelationships(
  structure: SentenceStructure,
  invalid: SourceCheckFailure = sourceCheckFailure,
): void {
  const { coreClauses, modifiers } = structure;
  let previousEnd = 0;
  for (const [index, core] of coreClauses.entries()) {
    const range = envelope(core.fragments, invalid);
    if (range.start < previousEnd)
      invalid(["coreClauses", index], "Main clauses must be ordered and non-overlapping.");
    previousEnd = range.end;
  }
  for (const [index, modifier] of modifiers.entries()) {
    const groups = modifier.target.kind === "core" ? coreClauses : modifiers;
    if (!groups[modifier.target.index])
      invalid(["modifiers", index, "target"], "Modifier target must exist in the same sentence.");
    const visited = new Set<number>([index]);
    let next = modifier.target;
    while (next.kind === "modifier") {
      if (visited.has(next.index))
        invalid(["modifiers", index, "target"], "Modifier relationships must be acyclic.");
      visited.add(next.index);
      const parent = modifiers[next.index];
      if (!parent)
        invalid(["modifiers", index, "target"], "Modifier target must exist in the same sentence.");
      next = parent.target;
    }
  }
  const groups = [
    ...coreClauses.map((group, index) => ({
      range: envelope(group.fragments, invalid),
      path: ["coreClauses", index],
    })),
    ...modifiers.map((group, index) => ({
      range: envelope(group.fragments, invalid),
      path: ["modifiers", index],
    })),
  ];
  for (const [index, group] of groups.entries()) {
    for (const other of groups.slice(index + 1)) {
      const [left, right] =
        group.range.start < other.range.start
          ? [group.range, other.range]
          : [other.range, group.range];
      if (left.start < right.start && right.start < left.end && left.end < right.end)
        invalid(other.path, "Teaching groups may nest but must not cross source ranges.");
    }
  }
}

export function checkTeachingStructure(
  source: string,
  structure: SentenceStructure,
  invalid: SourceCheckFailure = sourceCheckFailure,
): void {
  if (typeof source !== "string" || source.length > 2000 || !/\S/u.test(source))
    invalid([], "Invalid source text.");
  for (const key of ["coreClauses", "modifiers"] as const)
    for (const [index, group] of structure[key].entries())
      checkSourceSpans(source, group.fragments, (path, message) =>
        invalid([key, index, "fragments", ...path], message),
      );
  checkTeachingRelationships(structure, invalid);
}
export function checkSourceUnitSequence(
  source: string,
  units: readonly SentenceSourceUnit[],
  invalid: SourceCheckFailure = sourceCheckFailure,
): void {
  let cursor = 0;
  for (const [index, unit] of units.entries()) {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (
      unit.ordinal !== index ||
      unit.analysisUnitId !== `u${index + 1}` ||
      unit.sourceText !== unit.sourceText.trim() ||
      !source.startsWith(unit.sourceText, cursor)
    )
      invalid([index], "Source units must preserve the complete original text in order.");
    cursor += unit.sourceText.length;
    if (splitsSurrogatePair(source, cursor))
      invalid([index], "Source unit boundaries must not split Unicode surrogate pairs.");
  }
  if (source.slice(cursor).trim() !== "")
    invalid([], "Source units must account for all non-whitespace source text.");
}
