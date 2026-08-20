import { createHash } from "node:crypto";

import {
  deletePracticeSessionRequestSchema,
  deletePracticeSessionResponseSchema,
  listPracticeSessionsQuerySchema,
  practiceHistoryDetailResponseSchema,
  practiceHistoryListResponseSchema,
  type DeletePracticeSessionResponse,
  type ListPracticeSessionsQuery,
  type PracticeHistoryDetailResponse,
  type PracticeHistorySummary,
} from "@huayi/cloud-contracts";

import { createPracticeHistoryCursor } from "./practice-history-cursor.js";

interface DeleteCommand {
  expectedRevision: number;
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
  sessionId: string;
}

export interface PracticeHistoryRepository {
  delete(command: DeleteCommand): Promise<DeletePracticeSessionResponse>;
  findById(ownerUserId: string, id: string): Promise<PracticeHistoryDetailResponse | null>;
  list(
    ownerUserId: string,
    input: {
      boundary?: { completedAt: string | null; id: string };
      limit: number;
      status?: "active" | "awaiting-feedback" | "completed" | "failed";
      type?: "dialogue" | "sentence-creation";
    },
  ): Promise<{ hasMore: boolean; items: PracticeHistorySummary[] }>;
}

export function createPracticeHistoryModule(options: {
  cursorKey: Uint8Array;
  now(): Date;
  repository: PracticeHistoryRepository;
}) {
  const cursor = createPracticeHistoryCursor(options.cursorKey);
  return {
    async delete(
      ownerUserId: string,
      sessionId: string,
      idempotencyKey: string,
      input: { expectedRevision: number },
    ) {
      const request = deletePracticeSessionRequestSchema.parse(input);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ request, sessionId }))
        .digest("hex");
      return deletePracticeSessionResponseSchema.parse(
        await options.repository.delete({
          expectedRevision: request.expectedRevision,
          idempotencyKey,
          now: options.now().toISOString(),
          ownerUserId,
          requestHash,
          sessionId,
        }),
      );
    },
    async get(ownerUserId: string, id: string) {
      const found = await options.repository.findById(ownerUserId, id);
      return found === null ? null : practiceHistoryDetailResponseSchema.parse(found);
    },
    async list(ownerUserId: string, input: ListPracticeSessionsQuery) {
      const query = listPracticeSessionsQuerySchema.parse(input);
      const boundary = query.cursor === undefined ? undefined : cursor.decode(query.cursor);
      const page = await options.repository.list(ownerUserId, {
        ...(boundary === undefined
          ? {}
          : { boundary: { completedAt: boundary.completedAt, id: boundary.id } }),
        limit: query.limit ?? 20,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.type === undefined ? {} : { type: query.type }),
      });
      const last = page.items.at(-1);
      return practiceHistoryListResponseSchema.parse({
        items: page.items,
        nextCursor:
          page.hasMore && last !== undefined
            ? cursor.encode({ completedAt: last.completedAt, id: last.id })
            : null,
      });
    },
  };
}

export type PracticeHistoryModule = ReturnType<typeof createPracticeHistoryModule>;
