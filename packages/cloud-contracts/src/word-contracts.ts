import {
  contextObservationSchema,
  normalizeHeadword,
  wordEntrySchema,
} from "@huayi/learning-domain";
import { z } from "zod/v3";

import {
  cursorSchema,
  paginationQueryFields,
  resourceIdSchema,
  revisionWriteHeadersSchema,
  writeHeadersSchema,
} from "./common-contracts.js";

export { contextObservationSchema };

export const wordEntryCoreSchema = z
  .strictObject({
    canonicalKey: z.string().min(1).max(500),
    createdAt: z.string().datetime({ offset: true }),
    headword: z.string().trim().min(1).max(200),
    id: resourceIdSchema,
    notes: z.string().max(4_000).optional(),
    revision: z.number().int().min(1),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .refine((entry) => entry.canonicalKey === normalizeHeadword(entry.headword), {
    message: "Word canonical key must match its headword.",
  });
export type WordEntryCore = z.infer<typeof wordEntryCoreSchema>;
export const patchWordEntryResponseSchema = wordEntryCoreSchema;

export const manualWordContextSchema = z
  .strictObject({
    contextualMeaningZh: z.string().trim().min(1).max(2_000).optional(),
    sourceText: z.string().trim().min(1).max(2_000).optional(),
    sourceTitle: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (context) => context.sourceText !== undefined || context.contextualMeaningZh !== undefined,
    {
      message: "A manual word context requires source text or a contextual meaning.",
    },
  );
export const upsertWordRequestSchema = z.strictObject({
  context: manualWordContextSchema.optional(),
  headword: z.string().trim().min(1).max(200),
  notes: z.string().trim().min(1).max(4_000).optional(),
});
export type UpsertWordRequest = z.infer<typeof upsertWordRequestSchema>;
export const upsertWordResponseSchema = z.strictObject({
  contextOutcome: z.enum(["created", "duplicate", "omitted"]),
  word: wordEntryCoreSchema,
  wordOutcome: z.enum(["created", "existing"]),
});
export type UpsertWordResponse = z.infer<typeof upsertWordResponseSchema>;
export const patchWordEntryRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  notes: z.string().trim().min(1).max(4_000).nullable(),
});
export type PatchWordEntryRequest = z.infer<typeof patchWordEntryRequestSchema>;
export const patchWordRequestSchema = patchWordEntryRequestSchema;
export const deleteWordEntryRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export type DeleteWordEntryRequest = z.infer<typeof deleteWordEntryRequestSchema>;
export const deleteWordEntryResponseSchema = z.strictObject({
  deleted: z.literal(true),
  id: resourceIdSchema,
});
export type DeleteWordEntryResponse = z.infer<typeof deleteWordEntryResponseSchema>;

export const wordEntryResponseSchema = wordEntrySchema;
export const wordEntryListResponseSchema = z.strictObject({
  items: z.array(wordEntryCoreSchema).max(100),
  nextCursor: cursorSchema.nullable(),
});
export type WordEntryListResponse = z.infer<typeof wordEntryListResponseSchema>;
export const listWordEntriesQuerySchema = z.strictObject({
  ...paginationQueryFields,
  query: z.string().trim().min(1).max(200).optional(),
});
export type ListWordEntriesQuery = z.infer<typeof listWordEntriesQuerySchema>;

export const wordEntryDetailQuerySchema = z.strictObject({
  contextCursor: cursorSchema.optional(),
  contextLimit: paginationQueryFields.limit,
});
export type WordEntryDetailQuery = z.infer<typeof wordEntryDetailQuerySchema>;
export const wordEntryDetailResponseSchema = z.strictObject({
  contexts: z.strictObject({
    items: z.array(contextObservationSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  }),
  word: wordEntryCoreSchema,
});
export type WordEntryDetailResponse = z.infer<typeof wordEntryDetailResponseSchema>;
export const wordEntryMutationHeadersSchema = revisionWriteHeadersSchema;
export const wordEntryCreateHeadersSchema = writeHeadersSchema;
export const wordEntryHttpRoutes = Object.freeze({
  create: "/v1/words",
  delete: "/v1/words/:id",
  detail: "/v1/words/:id",
  list: "/v1/words",
  patch: "/v1/words/:id",
  export: "/v1/words:export",
});
export const wordListExportHeadersSchema = z.strictObject({
  "content-disposition": z.literal('attachment; filename="huayi-words.txt"'),
  "content-type": z.literal("text/plain; charset=utf-8"),
});
