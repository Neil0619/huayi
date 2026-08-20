import { describe, expect, it } from "vitest";

import {
  deleteWordEntryRequestSchema,
  listWordEntriesQuerySchema,
  wordEntryDetailQuerySchema,
  wordEntryDetailResponseSchema,
  wordEntryHttpRoutes,
  wordEntryListResponseSchema,
  wordEntryMutationHeadersSchema,
  patchWordEntryRequestSchema,
  upsertWordRequestSchema,
  upsertWordResponseSchema,
  wordEntryCreateHeadersSchema,
} from "./index.js";

const core = {
  canonicalKey: "run into",
  createdAt: "2026-08-13T01:00:00.000Z",
  headword: "run into",
  id: "word-1",
  notes: "偶遇",
  revision: 2,
  updatedAt: "2026-08-13T02:00:00.000Z",
};

describe("word library contracts", () => {
  it("strictly parses bounded list and detail views", () => {
    expect(wordEntryListResponseSchema.parse({ items: [core], nextCursor: null })).toMatchObject({
      items: [{ id: "word-1" }],
    });
    expect(
      wordEntryDetailResponseSchema.parse({
        contexts: {
          items: [
            {
              contextualMeaningZh: "偶然遇见",
              id: "context-1",
              observedAt: "2026-08-13T03:00:00.000Z",
              sourceText: "I ran into her yesterday.",
              sourceType: "manual",
            },
          ],
          nextCursor: "next-context",
        },
        word: core,
      }),
    ).toMatchObject({ contexts: { items: [{ id: "context-1" }] } });
    expect(() =>
      wordEntryListResponseSchema.parse({ items: [core], nextCursor: null, owner: "x" }),
    ).toThrow();
  });

  it("locks manual upsert to server-owned source metadata and strict outcomes", () => {
    expect(
      upsertWordRequestSchema.parse({
        context: { contextualMeaningZh: "偶然遇见", sourceText: "I ran into her." },
        headword: "run into",
        notes: "搭配",
      }),
    ).toEqual({
      context: { contextualMeaningZh: "偶然遇见", sourceText: "I ran into her." },
      headword: "run into",
      notes: "搭配",
    });
    expect(() =>
      upsertWordRequestSchema.parse({
        context: { observedAt: "2026-08-13T00:00:00.000Z", sourceType: "youtube" },
        headword: "run into",
      }),
    ).toThrow();
    expect(() => upsertWordRequestSchema.parse({ context: {}, headword: "run into" })).toThrow();
    expect(
      upsertWordResponseSchema.parse({
        contextOutcome: "created",
        word: core,
        wordOutcome: "existing",
      }),
    ).toMatchObject({ contextOutcome: "created", word: { id: "word-1" } });
    expect(() =>
      upsertWordResponseSchema.parse({
        contextOutcome: "created",
        ownerUserId: "owner-1",
        word: core,
        wordOutcome: "existing",
      }),
    ).toThrow();
    expect(wordEntryCreateHeadersSchema.parse({ "idempotency-key": "word-create-1" })).toEqual({
      "idempotency-key": "word-create-1",
    });
    expect(wordEntryHttpRoutes.create).toBe("/v1/words");
  });

  it("locks search, context pagination and mutations to strict fields", () => {
    expect(listWordEntriesQuerySchema.parse({ limit: "20", query: "  RUN INTO  " })).toEqual({
      limit: 20,
      query: "RUN INTO",
    });
    expect(wordEntryDetailQuerySchema.parse({ contextLimit: "10" })).toEqual({ contextLimit: 10 });
    expect(patchWordEntryRequestSchema.parse({ expectedRevision: 2, notes: null })).toEqual({
      expectedRevision: 2,
      notes: null,
    });
    expect(() =>
      patchWordEntryRequestSchema.parse({ expectedRevision: 2, headword: "renamed", notes: null }),
    ).toThrow();
    expect(deleteWordEntryRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(
      wordEntryMutationHeadersSchema.parse({
        "idempotency-key": "word-edit-1",
        "if-match": '"2"',
      }),
    ).toBeDefined();
    expect(wordEntryHttpRoutes).toEqual({
      create: "/v1/words",
      delete: "/v1/words/:id",
      detail: "/v1/words/:id",
      export: "/v1/words:export",
      list: "/v1/words",
      patch: "/v1/words/:id",
    });
  });
});
