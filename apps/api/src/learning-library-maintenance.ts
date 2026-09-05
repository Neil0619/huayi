import { createHash } from "node:crypto";
import type { ModelExecution } from "./model-execution.js";

import {
  canonicalKeyForContent,
  deleteLearningItemRequestSchema,
  deleteLearningItemResponseSchema,
  duplicateSuggestionsRequestSchema,
  duplicateSuggestionsResponseSchema,
  learningItemArchiveRequestSchema,
  learningItemDetailResponseSchema,
  learningItemMergeResponseSchema,
  mergeLearningItemsRequestSchema,
  mergePreviewResponseSchema,
  normalizeTagName,
  patchLearningItemRequestSchema,
  type DeleteLearningItemResponse,
  type DuplicateSuggestionsResponse,
  type LearningItemDetailResponse,
  type LearningItemArchiveRequest,
  type LearningItemMergeResponse,
  type MergeLearningItemsRequest,
  type MergePreviewResponse,
  type PatchLearningItemRequest,
} from "@huayi/cloud-contracts";

import type {
  DuplicateSuggestionCommand,
  PaidDuplicateSuggestionGenerator,
} from "./paid-duplicate-suggestion-generator.js";

interface MutationCommon {
  id: string;
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
}

export interface LearningLibraryMaintenanceRepository {
  archive(
    command: MutationCommon & { expectedRevision: number },
  ): Promise<LearningItemDetailResponse>;
  delete(
    command: MutationCommon & { expectedRevision: number },
  ): Promise<DeleteLearningItemResponse>;
  merge(command: MutationCommon & MergeLearningItemsRequest): Promise<LearningItemMergeResponse>;
  patch(
    command: MutationCommon & {
      canonicalKey: string;
      expectedRevision: number;
      request: PatchLearningItemRequest;
      tags: { displayName: string; normalizedName: string }[];
    },
  ): Promise<LearningItemDetailResponse>;
  previewMerge(
    ownerUserId: string,
    sourceId: string,
    request: MergeLearningItemsRequest,
  ): Promise<MergePreviewResponse>;
  suggestionContext(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
  ): Promise<{ candidates: LearningItemDetailResponse[]; source: LearningItemDetailResponse }>;
  restore(
    command: MutationCommon & { expectedRevision: number },
  ): Promise<LearningItemDetailResponse>;
}

export type LearningDuplicateSuggestions = Pick<PaidDuplicateSuggestionGenerator, "suggest">;

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createLearningLibraryMaintenance(options: {
  duplicateSuggestions: LearningDuplicateSuggestions;
  now: () => Date;
  repository: LearningLibraryMaintenanceRepository;
}) {
  const common = (
    operation: string,
    ownerUserId: string,
    id: string,
    idempotencyKey: string,
    request: unknown,
  ) => ({
    id,
    idempotencyKey,
    now: options.now().toISOString(),
    ownerUserId,
    requestHash: requestHash({ id, operation, request }),
  });
  return {
    async archive(
      ownerUserId: string,
      id: string,
      idempotencyKey: string,
      input: LearningItemArchiveRequest,
    ) {
      const request = learningItemArchiveRequestSchema.parse(input);
      return learningItemDetailResponseSchema.parse(
        await options.repository.archive({
          ...common("archive", ownerUserId, id, idempotencyKey, request),
          expectedRevision: request.expectedRevision,
        }),
      );
    },
    async confirmMerge(
      ownerUserId: string,
      sourceId: string,
      idempotencyKey: string,
      input: MergeLearningItemsRequest,
    ) {
      const request = mergeLearningItemsRequestSchema.parse(input);
      return learningItemMergeResponseSchema.parse(
        await options.repository.merge({
          ...common("merge", ownerUserId, sourceId, idempotencyKey, request),
          ...request,
        }),
      );
    },
    async delete(
      ownerUserId: string,
      id: string,
      idempotencyKey: string,
      input: { expectedRevision: number },
    ) {
      const request = deleteLearningItemRequestSchema.parse(input);
      return deleteLearningItemResponseSchema.parse(
        await options.repository.delete({
          ...common("delete", ownerUserId, id, idempotencyKey, request),
          expectedRevision: request.expectedRevision,
        }),
      );
    },
    async patch(
      ownerUserId: string,
      id: string,
      idempotencyKey: string,
      input: PatchLearningItemRequest,
    ) {
      const request = patchLearningItemRequestSchema.parse(input);
      return learningItemDetailResponseSchema.parse(
        await options.repository.patch({
          ...common("patch", ownerUserId, id, idempotencyKey, request),
          canonicalKey: canonicalKeyForContent(request.content),
          expectedRevision: request.expectedRevision,
          request,
          tags: request.tags.map((displayName) => ({
            displayName,
            normalizedName: normalizeTagName(displayName),
          })),
        }),
      );
    },
    async previewMerge(ownerUserId: string, sourceId: string, input: MergeLearningItemsRequest) {
      const request = mergeLearningItemsRequestSchema.parse(input);
      return mergePreviewResponseSchema.parse(
        await options.repository.previewMerge(ownerUserId, sourceId, request),
      );
    },
    async suggestions(
      ownerUserId: string,
      id: string,
      idempotencyKey: string,
      input: { expectedRevision: number },
      execution: ModelExecution = {},
    ): Promise<DuplicateSuggestionsResponse> {
      const request = duplicateSuggestionsRequestSchema.parse(input);
      const context = await options.repository.suggestionContext(
        ownerUserId,
        id,
        request.expectedRevision,
      );
      const command: DuplicateSuggestionCommand = {
        ...execution,
        candidates: context.candidates,
        idempotencyKey,
        ownerUserId,
        source: context.source,
      };
      return duplicateSuggestionsResponseSchema.parse(
        await options.duplicateSuggestions.suggest(command),
      );
    },
    async restore(
      ownerUserId: string,
      id: string,
      idempotencyKey: string,
      input: LearningItemArchiveRequest,
    ) {
      const request = learningItemArchiveRequestSchema.parse(input);
      return learningItemDetailResponseSchema.parse(
        await options.repository.restore({
          ...common("restore", ownerUserId, id, idempotencyKey, request),
          expectedRevision: request.expectedRevision,
        }),
      );
    },
  };
}

export type LearningLibraryMaintenance = ReturnType<typeof createLearningLibraryMaintenance>;
