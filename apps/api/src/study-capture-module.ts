import { createHash } from "node:crypto";

import {
  studyCaptureDeleteRequestSchema,
  studyCaptureDeleteResponseSchema,
  studyCaptureDetailResponseSchema,
  studyCaptureListQuerySchema,
  studyCaptureListResponseSchema,
  studyCapturePatchRequestSchema,
  studyCapturePatchResponseSchema,
  studyCaptureCreateRequestSchema,
  studyCaptureCreateResponseSchema,
  normalizeWhitespaceAndQuotes,
  type StudyCaptureCreateRequest,
  type StudyCaptureDetailResponse,
  type StudyCaptureListQuery,
} from "@huayi/cloud-contracts";
import { createStudyCaptureCursor } from "./study-capture-cursor.js";

export interface StudyCaptureRepository {
  create(command: {
    idempotencyKey: string;
    normalizedSourceText: string;
    normalizedTextHash: string;
    now: string;
    ownerUserId: string;
    request: StudyCaptureCreateRequest;
    requestHash: string;
  }): Promise<unknown>;
  delete(command: {
    captureId: string;
    expectedRevision: number;
    idempotencyKey: string;
    now: string;
    ownerUserId: string;
    requestHash: string;
  }): Promise<unknown>;
  find(ownerUserId: string, captureId: string): Promise<StudyCaptureDetailResponse | null>;
  list(
    ownerUserId: string,
    query: Omit<StudyCaptureListQuery, "cursor"> & {
      boundary?: { id: string; updatedAt: string };
    },
  ): Promise<{ hasMore: boolean; items: StudyCaptureDetailResponse[] }>;
  patch(command: {
    captureId: string;
    idempotencyKey: string;
    input: ReturnType<typeof studyCapturePatchRequestSchema.parse>;
    now: string;
    ownerUserId: string;
    requestHash: string;
  }): Promise<unknown>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createStudyCaptureModule(options: {
  cursorKey: Uint8Array;
  now(): Date;
  repository: StudyCaptureRepository;
}) {
  const cursor = createStudyCaptureCursor(options.cursorKey);
  return {
    async create(ownerUserId: string, input: unknown, idempotencyKey: string) {
      const request = studyCaptureCreateRequestSchema.parse(input);
      const normalizedSourceText = normalizeWhitespaceAndQuotes(request.sourceText);
      return studyCaptureCreateResponseSchema.parse(
        await options.repository.create({
          idempotencyKey,
          normalizedSourceText,
          normalizedTextHash: sha256(normalizedSourceText),
          now: options.now().toISOString(),
          ownerUserId,
          request,
          requestHash: sha256(JSON.stringify(request)),
        }),
      );
    },
    async delete(ownerUserId: string, captureId: string, input: unknown, idempotencyKey: string) {
      const request = studyCaptureDeleteRequestSchema.parse(input);
      return studyCaptureDeleteResponseSchema.parse(
        await options.repository.delete({
          captureId,
          expectedRevision: request.expectedRevision,
          idempotencyKey,
          now: options.now().toISOString(),
          ownerUserId,
          requestHash: sha256(JSON.stringify({ captureId, ...request })),
        }),
      );
    },
    async get(ownerUserId: string, captureId: string) {
      return studyCaptureDetailResponseSchema
        .nullable()
        .parse(await options.repository.find(ownerUserId, captureId));
    },
    async list(ownerUserId: string, rawQuery: unknown) {
      const query = studyCaptureListQuerySchema.parse(rawQuery);
      const result = await options.repository.list(ownerUserId, {
        ...(query.cursor === undefined ? {} : { boundary: cursor.decode(query.cursor) }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        limit: query.limit,
        ...(query.query === undefined ? {} : { query: query.query }),
        status: query.status,
      });
      const items = result.items.slice(0, query.limit);
      const last = items.at(-1)?.capture;
      return studyCaptureListResponseSchema.parse({
        items,
        nextCursor:
          result.hasMore && last !== undefined
            ? cursor.encode({ id: last.id, updatedAt: last.updatedAt })
            : null,
      });
    },
    async patch(ownerUserId: string, captureId: string, input: unknown, idempotencyKey: string) {
      const request = studyCapturePatchRequestSchema.parse(input);
      return studyCapturePatchResponseSchema.parse(
        await options.repository.patch({
          captureId,
          idempotencyKey,
          input: request,
          now: options.now().toISOString(),
          ownerUserId,
          requestHash: sha256(JSON.stringify({ captureId, ...request })),
        }),
      );
    },
  };
}

export type StudyCaptureModule = ReturnType<typeof createStudyCaptureModule>;
