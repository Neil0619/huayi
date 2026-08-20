import { z } from "zod/v3";

import {
  MAX_CONTEXT_SENTENCE_LENGTH,
  MAX_HEADWORD_LENGTH,
  normalizeHeadword,
  normalizeObservationSentence,
} from "./normalization.js";

const idSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.string().datetime({ offset: true });

export const observationSourceSchema = z.enum(["web", "youtube", "eudic-import"]);
export type ObservationSource = z.infer<typeof observationSourceSchema>;

const sourcedObservationFields = {
  id: idSchema,
  observedAt: timestampSchema,
  sentence: z.string().trim().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH),
};

export const contextObservationSchema = z.discriminatedUnion("source", [
  z.strictObject({
    ...sourcedObservationFields,
    contextualMeaningZh: z.string().trim().min(1).max(1_000),
    source: z.enum(["web", "youtube"]),
  }),
  z.strictObject({
    ...sourcedObservationFields,
    source: z.literal("eudic-import"),
  }),
]);
export type ContextObservation = z.infer<typeof contextObservationSchema>;

export const wordEntrySchema = z
  .strictObject({
    contexts: z.array(contextObservationSchema).max(1_000),
    createdAt: timestampSchema,
    headword: z.string().trim().min(1).max(MAX_HEADWORD_LENGTH),
    id: idSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((entry, context) => {
    let normalizedHeadword: string;
    try {
      normalizedHeadword = normalizeHeadword(entry.headword);
    } catch {
      context.addIssue({ code: "custom", message: "Headword is invalid.", path: ["headword"] });
      return;
    }
    if (entry.id !== normalizedHeadword || entry.headword !== normalizedHeadword) {
      context.addIssue({
        code: "custom",
        message: "Word identity and headword must use canonical normalization.",
        path: ["id"],
      });
    }
    const observationKeys = entry.contexts.map(
      (observation) =>
        `${observation.source}\u0000${normalizeObservationSentence(observation.sentence)}`,
    );
    if (new Set(observationKeys).size !== observationKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Context observations must be unique by source and normalized sentence.",
        path: ["contexts"],
      });
    }
  });
export type WordEntry = z.infer<typeof wordEntrySchema>;

export type ContextObservationInput =
  | {
      readonly contextualMeaningZh: string;
      readonly sentence: string;
      readonly source: "web" | "youtube";
    }
  | {
      readonly observedAt: string;
      readonly sentence: string;
      readonly source: "eudic-import";
    };

export interface SaveWordInput {
  readonly context?: ContextObservationInput;
  readonly headword: string;
}

export interface LexiconQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly search?: string;
}

export interface LexiconPage {
  readonly entries: readonly WordEntry[];
  readonly nextCursor: string | null;
}

export interface LexiconRepository {
  save(input: SaveWordInput): Promise<WordEntry>;
  findByHeadword(headword: string): Promise<WordEntry | null>;
  list(query: LexiconQuery): Promise<LexiconPage>;
  snapshot(): Promise<readonly WordEntry[]>;
  delete(entryId: string): Promise<boolean>;
  exportWordList(): Promise<string>;
}
