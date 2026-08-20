import { createHash } from "node:crypto";

import {
  canonicalKeyForContent,
  createLearningItemRequestSchema,
  learningItemDetailResponseSchema,
  learningItemListResponseSchema,
  listLearningItemsQuerySchema,
  normalizeTagName,
  type CreateLearningItemRequest,
  type LearningItemDetailResponse,
  type ListLearningItemsQuery,
} from "@huayi/cloud-contracts";

import { createLearningLibraryCursor } from "./learning-library-cursor.js";

export interface LearningLibraryRepository {
  create(command: {
    canonicalKey: string;
    id: string;
    idempotencyKey: string;
    now: string;
    ownerUserId: string;
    request: CreateLearningItemRequest;
    requestHash: string;
    tags: { displayName: string; normalizedName: string }[];
  }): Promise<LearningItemDetailResponse>;
  findById(ownerUserId: string, id: string): Promise<LearningItemDetailResponse | null>;
  list(
    ownerUserId: string,
    query: {
      archived: boolean;
      boundary?: { createdAt: string; id: string };
      due?: "due" | "new";
      dueAt: string;
      limit: number;
      query?: string;
      systemAttribute?: string;
      tag?: string;
      type?: "expression" | "sentence-pattern";
    },
  ): Promise<{ hasMore: boolean; items: LearningItemDetailResponse[] }>;
}

export function createLearningLibraryModule(options: {
  cursorKey: Uint8Array;
  id?: () => string;
  now: () => Date;
  repository: LearningLibraryRepository;
}) {
  const cursor = createLearningLibraryCursor(options.cursorKey);
  return {
    async create(ownerUserId: string, idempotencyKey: string, input: CreateLearningItemRequest) {
      const request = createLearningItemRequestSchema.parse(input);
      const response = await options.repository.create({
        canonicalKey: canonicalKeyForContent(request.content),
        id: options.id?.() ?? crypto.randomUUID(),
        idempotencyKey,
        now: options.now().toISOString(),
        ownerUserId,
        request,
        requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        tags: request.tags.map((displayName) => ({
          displayName,
          normalizedName: normalizeTagName(displayName),
        })),
      });
      return learningItemDetailResponseSchema.parse(response);
    },
    async get(ownerUserId: string, id: string) {
      const found = await options.repository.findById(ownerUserId, id);
      return found === null ? null : learningItemDetailResponseSchema.parse(found);
    },
    async list(ownerUserId: string, input: ListLearningItemsQuery) {
      const query = listLearningItemsQuerySchema.parse(input);
      const filters = {
        archived: query.archived,
        ...(query.due === undefined ? {} : { due: query.due }),
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.systemAttribute === undefined ? {} : { systemAttribute: query.systemAttribute }),
        ...(query.tag === undefined ? {} : { tag: normalizeTagName(query.tag) }),
        ...(query.type === undefined ? {} : { type: query.type }),
      };
      const filterHash = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
      const page = await options.repository.list(ownerUserId, {
        ...filters,
        ...(query.cursor === undefined
          ? {}
          : { boundary: cursor.decode(query.cursor, filterHash) }),
        dueAt: options.now().toISOString(),
        limit: query.limit ?? 20,
      });
      const last = page.items.at(-1);
      return learningItemListResponseSchema.parse({
        items: page.items,
        nextCursor:
          page.hasMore && last !== undefined
            ? cursor.encode({ createdAt: last.item.createdAt, id: last.item.id }, filterHash)
            : null,
      });
    },
  };
}
export type LearningLibraryModule = ReturnType<typeof createLearningLibraryModule>;
