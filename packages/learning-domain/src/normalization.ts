export const MAX_HEADWORD_LENGTH = 200;
export const MAX_CONTEXT_SENTENCE_LENGTH = 2_000;

const quoteMap: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
};

export function normalizeWhitespaceAndQuotes(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’“”]/gu, (quote) => quoteMap[quote] ?? quote)
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeCanonicalText(value: string): string {
  return normalizeWhitespaceAndQuotes(value).toLocaleLowerCase("en-US");
}

export function normalizeHeadword(value: string): string {
  const normalized = normalizeCanonicalText(value);
  if (normalized.length === 0 || normalized.length > MAX_HEADWORD_LENGTH) {
    throw new Error("Headword must be non-empty and at most 200 characters.");
  }
  return normalized;
}

export function normalizeObservationSentence(value: string): string {
  const normalized = normalizeWhitespaceAndQuotes(value);
  if (normalized.length === 0 || normalized.length > MAX_CONTEXT_SENTENCE_LENGTH) {
    throw new Error("Observation sentence must be non-empty and at most 2,000 characters.");
  }
  return normalized;
}

export interface ExpressionIdentityInput {
  readonly text: string;
  readonly type: "expression";
}

export interface SentencePatternIdentityInput {
  readonly slots: readonly { readonly name: string }[];
  readonly template: string;
  readonly type: "sentence_pattern";
}

export type LearningIdentityInput = ExpressionIdentityInput | SentencePatternIdentityInput;

export function canonicalKeyForContent(content: LearningIdentityInput): string {
  if (content.type === "expression") return normalizeCanonicalText(content.text);
  const normalizedTemplate = normalizeCanonicalText(content.template);
  const names = new Map(
    content.slots.map((slot, index) => [normalizeCanonicalText(slot.name), `{slot${index + 1}}`]),
  );
  return normalizedTemplate.replace(/\{([^{}]+)\}/gu, (placeholder, name: string) => {
    return names.get(normalizeCanonicalText(name)) ?? placeholder;
  });
}

export function exactDuplicateIdentity(content: LearningIdentityInput): string {
  const type = content.type === "sentence_pattern" ? "sentence-pattern" : content.type;
  return `${type}:${canonicalKeyForContent(content)}`;
}
