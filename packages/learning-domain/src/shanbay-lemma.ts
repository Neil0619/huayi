// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Consumers compile this package's source; the untyped CJS dependency has no importable type module.
/// <reference path="./wink-lemmatizer.d.ts" />
import lemmatizer from "wink-lemmatizer";
import { backfillHeadwordSchema } from "./shanbay-backfill-schema.js";

/** Distinct changed noun/verb/adjective candidates, in that order. */
export function findBackfillLemmaCandidates(value: string): string[] {
  const parsed = backfillHeadwordSchema.safeParse(value);
  if (!parsed.success) return [];
  const word = parsed.data;
  return [
    ...new Set(
      [lemmatizer.noun(word), lemmatizer.verb(word), lemmatizer.adjective(word)].flatMap(
        (candidate) => {
          const result = backfillHeadwordSchema.safeParse(candidate);
          return result.success && result.data !== word ? [result.data] : [];
        },
      ),
    ),
  ];
}

/** Classic noun/verb/adjective rule: retry only one distinct valid candidate. */
export function findBackfillLemma(value: string): string | null {
  const candidates = findBackfillLemmaCandidates(value);
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
