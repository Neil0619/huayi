import { StreamingJsonTokenizer } from "@huayi/cloud-contracts";
import { analysisUpdateSchema, type AnalysisUpdate } from "@huayi/cloud-contracts";
import type { z } from "zod/v3";

const textFields: Readonly<Record<string, string>> = {
  mainStructure: "main-structure",
  translationZh: "translation",
  contextRole: "context-role",
  contextualMeaningZh: "contextual-meaning",
  contextualAnalysisZh: "contextual-analysis",
};
const structuredFields: Readonly<Record<string, string>> = {
  keyExpressions: "key-expressions",
  baseForm: "base-form",
  collocations: "collocations",
  commonMeanings: "common-meanings",
  commonPhrases: "common-phrases",
  confusableWords: "confusable-words",
  contextExample: "context-example",
  contextualSense: "contextual-sense",
  coreMeanings: "core-meanings",
  partOfSpeech: "part-of-speech",
  pronunciation: "pronunciation",
  similarTerms: "similar-terms",
  synonyms: "synonyms",
  usageNotes: "usage-notes",
  wordForm: "word-form",
  wordFormation: "word-formation",
  wordFormationZh: "word-formation",
};

export function createQueryModelPreview(options: {
  requestId: string;
  type: string;
  shape: Readonly<Record<string, z.ZodType<unknown>>>;
  emit: (value: AnalysisUpdate) => void;
}) {
  const parser = new StreamingJsonTokenizer();
  const arrays = new Map<string, unknown[]>();
  const strings = new Map<string, string>();
  let sequence = 0,
    characters = 0,
    invalid = false;
  return (chunk: string): void => {
    if (invalid) return;
    try {
      for (const update of parser.push(chunk)) {
        const schema = options.shape[update.field];
        if (!schema) continue;
        if (update.kind === "string-delta") {
          const section = textFields[update.field];
          if (!section) continue;
          const cumulative = (strings.get(update.field) ?? "") + update.value;
          strings.set(update.field, cumulative);
          if (characters + update.value.length > 16_000 || !schema.safeParse(cumulative).success)
            continue;
          characters += update.value.length;
          for (let offset = 0; offset < update.value.length;) {
            const text = Array.from(update.value.slice(offset)).slice(0, 2_000).join("");
            options.emit(
              analysisUpdateSchema.parse({
                requestId: options.requestId,
                type: "delta",
                section,
                sequence: sequence++,
                text,
              }),
            );
            offset += text.length;
          }
          continue;
        }
        let section = structuredFields[update.field];
        if (!section) continue;
        if (update.field === "synonyms" && options.type === "explain-word")
          section = "synonym-comparisons";
        let value = update.value;
        if (update.kind === "array-item") {
          const values = arrays.get(update.field) ?? [];
          if (values.length !== update.index) throw new Error("Out of order preview item");
          value = [...values, value];
          arrays.set(update.field, value as unknown[]);
        } else if (arrays.has(update.field)) continue;
        const parsed = schema.safeParse(value);
        if (!parsed.success || (Array.isArray(parsed.data) && parsed.data.length === 0)) continue;
        const preview = analysisUpdateSchema.safeParse({
          requestId: options.requestId,
          type: "section",
          section,
          sequence,
          value: parsed.data,
        });
        if (preview.success) {
          sequence++;
          options.emit(preview.data);
        }
      }
    } catch {
      invalid = true; /* The complete output still receives strict validation and one repair. */
    }
  };
}
