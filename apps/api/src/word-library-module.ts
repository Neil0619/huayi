import { createHash } from "node:crypto";

import {
  deleteWordEntryRequestSchema,
  deleteWordEntryResponseSchema,
  listWordEntriesQuerySchema,
  normalizeHeadword,
  patchWordEntryResponseSchema,
  patchWordEntryRequestSchema,
  upsertWordRequestSchema,
  upsertWordResponseSchema,
  wordEntryDetailQuerySchema,
  wordEntryDetailResponseSchema,
  wordEntryListResponseSchema,
  type DeleteWordEntryResponse,
  type ListWordEntriesQuery,
  type PatchWordEntryRequest,
  type WordEntryCore,
  type WordEntryDetailQuery,
  type WordEntryDetailResponse,
  type UpsertWordRequest,
  type UpsertWordResponse,
} from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import { createWordLibraryCursor } from "./word-library-cursor.js";

type Context = WordEntryDetailResponse["contexts"]["items"][number];
interface DetailPage {
  contexts: Context[];
  hasMore: boolean;
  word: WordEntryCore;
}
interface MutationCommand<Request> {
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  request: Request;
  requestHash: string;
  wordId: string;
}
export interface UpsertWordCommand {
  canonicalKey: string;
  context?: NonNullable<UpsertWordRequest["context"]> & {
    contentHash: string;
    id: string;
    observedAt: string;
    sourceType: "manual";
  };
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  request: UpsertWordRequest;
  requestHash: string;
  wordId: string;
}

export interface WordLibraryRepository {
  delete(command: MutationCommand<{ expectedRevision: number }>): Promise<DeleteWordEntryResponse>;
  findById(
    ownerUserId: string,
    wordId: string,
    query: { boundary?: { id: string; observedAt: string }; limit: number },
  ): Promise<DetailPage | null>;
  list(
    ownerUserId: string,
    query: {
      boundary?: { createdAt: string; id: string };
      canonicalQuery?: string;
      limit: number;
    },
  ): Promise<{ hasMore: boolean; items: WordEntryCore[] }>;
  patch(command: MutationCommand<PatchWordEntryRequest>): Promise<WordEntryCore>;
  upsert(command: UpsertWordCommand): Promise<UpsertWordResponse>;
}

function hash(wordId: string | null, request: unknown) {
  return createHash("sha256").update(JSON.stringify({ request, wordId })).digest("hex");
}

export function createWordLibraryModule(options: {
  cursorKey: Uint8Array;
  ids(): string;
  now(): Date;
  repository: WordLibraryRepository;
}) {
  const cursor = createWordLibraryCursor(options.cursorKey);
  const detailResponse = (page: DetailPage) => {
    const last = page.contexts.at(-1);
    return wordEntryDetailResponseSchema.parse({
      contexts: {
        items: page.contexts,
        nextCursor:
          page.hasMore && last !== undefined
            ? cursor.contexts.encode({
                id: last.id,
                observedAt: last.observedAt,
                wordId: page.word.id,
              })
            : null,
      },
      word: page.word,
    });
  };
  return {
    async delete(ownerUserId: string, wordId: string, idempotencyKey: string, input: unknown) {
      const request = deleteWordEntryRequestSchema.parse(input);
      return deleteWordEntryResponseSchema.parse(
        await options.repository.delete({
          idempotencyKey,
          now: options.now().toISOString(),
          ownerUserId,
          request,
          requestHash: hash(wordId, request),
          wordId,
        }),
      );
    },
    async get(ownerUserId: string, wordId: string, input: WordEntryDetailQuery) {
      const query = wordEntryDetailQuerySchema.parse(input);
      const decoded =
        query.contextCursor === undefined ? undefined : cursor.contexts.decode(query.contextCursor);
      if (decoded !== undefined && decoded.wordId !== wordId) {
        throw new CloudFault("invalid_request", "The context cursor is for another word.");
      }
      const found = await options.repository.findById(ownerUserId, wordId, {
        ...(decoded === undefined
          ? {}
          : { boundary: { id: decoded.id, observedAt: decoded.observedAt } }),
        limit: query.contextLimit ?? 20,
      });
      return found === null ? null : detailResponse(found);
    },
    async list(ownerUserId: string, input: ListWordEntriesQuery) {
      const query = listWordEntriesQuerySchema.parse(input);
      const page = await options.repository.list(ownerUserId, {
        ...(query.cursor === undefined ? {} : { boundary: cursor.words.decode(query.cursor) }),
        ...(query.query === undefined ? {} : { canonicalQuery: normalizeHeadword(query.query) }),
        limit: query.limit ?? 20,
      });
      const last = page.items.at(-1);
      return wordEntryListResponseSchema.parse({
        items: page.items,
        nextCursor:
          page.hasMore && last !== undefined
            ? cursor.words.encode({ createdAt: last.createdAt, id: last.id })
            : null,
      });
    },
    async patch(
      ownerUserId: string,
      wordId: string,
      idempotencyKey: string,
      input: PatchWordEntryRequest,
    ) {
      const request = patchWordEntryRequestSchema.parse(input);
      return patchWordEntryResponseSchema.parse(
        await options.repository.patch({
          idempotencyKey,
          now: options.now().toISOString(),
          ownerUserId,
          request,
          requestHash: hash(wordId, request),
          wordId,
        }),
      );
    },
    async upsert(ownerUserId: string, idempotencyKey: string, input: unknown) {
      const request = upsertWordRequestSchema.parse(input);
      const now = options.now().toISOString();
      const wordId = options.ids();
      const context =
        request.context === undefined
          ? undefined
          : {
              ...request.context,
              contentHash: createHash("sha256")
                .update(JSON.stringify(request.context))
                .digest("hex"),
              id: options.ids(),
              observedAt: now,
              sourceType: "manual" as const,
            };
      return upsertWordResponseSchema.parse(
        await options.repository.upsert({
          canonicalKey: normalizeHeadword(request.headword),
          ...(context === undefined ? {} : { context }),
          idempotencyKey,
          now,
          ownerUserId,
          request,
          requestHash: hash(null, request),
          wordId,
        }),
      );
    },
  };
}

export type WordLibraryModule = ReturnType<typeof createWordLibraryModule>;
