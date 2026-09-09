import { z } from "zod/v3";
import { cursorSchema, paginationQueryFields, queryBoolean } from "./common-contracts.js";
import { wordEntryCoreSchema, wordEntryDetailResponseSchema } from "./word-contracts.js";
export const wordCatalogEntrySchema = z.strictObject({
  word: wordEntryCoreSchema,
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export const wordCatalogListSchema = z.strictObject({
  items: z.array(wordCatalogEntrySchema).max(100),
  nextCursor: cursorSchema.nullable(),
});
export const wordCatalogDetailSchema = wordEntryDetailResponseSchema.extend({
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export const wordCatalogQuerySchema = z.strictObject({
  ...paginationQueryFields,
  archived: queryBoolean.default(false),
  query: z.string().trim().min(1).max(200).optional(),
});
export const wordArchiveRequestSchema = z.strictObject({
  archived: z.boolean(),
  expectedRevision: z.number().int().min(1),
});
export const wordCatalogRoutes = Object.freeze({
  list: "/v2/words",
  detail: "/v2/words/:id",
  archive: "/v2/words/:id/archive",
});
