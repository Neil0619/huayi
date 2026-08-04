import { englishWordSchema } from "@huayi/protocol";
import lemmatizer from "wink-lemmatizer";

export type LemmaCandidateResult =
  | { candidates: []; kind: "none" }
  | { candidates: string[]; kind: "ambiguous" }
  | { candidates: [string]; kind: "unique"; word: string };

function normalizeWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("’", "'");
}

export function findUniqueLemmaCandidate(value: string): LemmaCandidateResult {
  const parsed = englishWordSchema.safeParse(value);
  if (!parsed.success) return { candidates: [], kind: "none" };
  const source = normalizeWord(parsed.data);
  const candidates = [
    lemmatizer.noun(source),
    lemmatizer.verb(source),
    lemmatizer.adjective(source),
  ]
    .map(normalizeWord)
    .filter((candidate) => candidate !== source && englishWordSchema.safeParse(candidate).success);
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) return { candidates: [], kind: "none" };
  if (uniqueCandidates.length > 1) {
    return { candidates: uniqueCandidates, kind: "ambiguous" };
  }
  const word = uniqueCandidates[0];
  if (word === undefined) return { candidates: [], kind: "none" };
  return { candidates: [word], kind: "unique", word };
}
