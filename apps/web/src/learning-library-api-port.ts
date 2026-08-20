import type {
  CreateLearningItemRequest,
  DeleteLearningItemResponse,
  DeleteLearningItemRequest,
  DuplicateSuggestionsRequest,
  DuplicateSuggestionsResponse,
  LearningItemDetailResponse,
  LearningItemArchiveRequest,
  LearningItemListResponse,
  LearningItemMergeResponse,
  ListLearningItemsQuery,
  MergeLearningItemsRequest,
  MergePreviewResponse,
  PatchLearningItemRequest,
} from "@huayi/cloud-contracts";

export interface LearningLibraryApi {
  archiveLearningItem(
    id: string,
    input: LearningItemArchiveRequest,
    idempotencyKey: string,
  ): Promise<LearningItemDetailResponse>;
  confirmLearningItemMerge(
    id: string,
    input: MergeLearningItemsRequest,
    idempotencyKey: string,
  ): Promise<LearningItemMergeResponse>;
  createLearningItem(
    input: CreateLearningItemRequest,
    idempotencyKey: string,
  ): Promise<LearningItemDetailResponse>;
  deleteLearningItem(
    id: string,
    input: DeleteLearningItemRequest,
    idempotencyKey: string,
  ): Promise<DeleteLearningItemResponse>;
  getLearningItem(id: string): Promise<LearningItemDetailResponse>;
  listLearningItems(input: ListLearningItemsQuery): Promise<LearningItemListResponse>;
  patchLearningItem(
    id: string,
    input: PatchLearningItemRequest,
    idempotencyKey: string,
  ): Promise<LearningItemDetailResponse>;
  previewLearningItemMerge(
    id: string,
    input: MergeLearningItemsRequest,
  ): Promise<MergePreviewResponse>;
  restoreLearningItem(
    id: string,
    input: LearningItemArchiveRequest,
    idempotencyKey: string,
  ): Promise<LearningItemDetailResponse>;
  suggestLearningItemDuplicates(
    id: string,
    input: DuplicateSuggestionsRequest,
    idempotencyKey: string,
  ): Promise<DuplicateSuggestionsResponse>;
}
