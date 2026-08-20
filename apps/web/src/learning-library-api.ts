import {
  apiErrorSchema,
  createLearningItemRequestSchema,
  createLearningItemResponseSchema,
  createLearningItemWriteHeadersSchema,
  deleteLearningItemRequestSchema,
  deleteLearningItemResponseSchema,
  duplicateSuggestionsHeadersSchema,
  duplicateSuggestionsRequestSchema,
  duplicateSuggestionsResponseSchema,
  learningItemDetailResponseSchema,
  learningItemArchiveRequestSchema,
  learningItemHttpRoutes,
  learningItemListResponseSchema,
  learningItemMergeResponseSchema,
  learningItemMutationHeadersSchema,
  listLearningItemsQuerySchema,
  mergeLearningItemsRequestSchema,
  mergePreviewResponseSchema,
  patchLearningItemRequestSchema,
  type ListLearningItemsQuery,
  type ApiError,
  type CreateLearningItemRequest,
  type DeleteLearningItemRequest,
  type DuplicateSuggestionsRequest,
  type LearningItemArchiveRequest,
  type MergeLearningItemsRequest,
  type PatchLearningItemRequest,
} from "@huayi/cloud-contracts";

export class WebLearningLibraryApiError extends Error {
  constructor(readonly code: ApiError["error"]["code"] | "unknown") {
    super("Huayi learning library request failed.");
  }
}

export function createWebLearningLibraryApi(options: {
  apiOrigin: string;
  csrfToken?(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const success = async (response: Response) => {
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new WebLearningLibraryApiError(parsed.success ? parsed.data.error.code : "unknown");
    }
    return response.json() as Promise<unknown>;
  };
  const itemPath = (route: string, id: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(id)) {
      throw new Error("Invalid learning item id.");
    }
    return route.replace(":id", encodeURIComponent(id));
  };
  const csrf = async () => {
    if (options.csrfToken === undefined) throw new WebLearningLibraryApiError("forbidden");
    return options.csrfToken();
  };
  const jsonRequest = async (path: string, method: string, body: unknown, headers = {}) =>
    success(
      await options.fetch(new URL(path, options.apiOrigin), {
        body: JSON.stringify(body),
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...headers,
          "x-csrf-token": await csrf(),
        },
        method,
      }),
    );
  return {
    async archiveLearningItem(
      id: string,
      input: LearningItemArchiveRequest,
      idempotencyKey: string,
    ) {
      const request = learningItemArchiveRequestSchema.parse(input);
      const headers = learningItemMutationHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
        "if-match": `"${request.expectedRevision}"`,
      });
      return learningItemDetailResponseSchema.parse(
        await jsonRequest(itemPath(learningItemHttpRoutes.archive, id), "POST", request, headers),
      );
    },
    async createLearningItem(input: CreateLearningItemRequest, idempotencyKey: string) {
      const request = createLearningItemRequestSchema.parse(input);
      const headers = createLearningItemWriteHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
      });
      if (options.csrfToken === undefined) throw new WebLearningLibraryApiError("forbidden");
      return createLearningItemResponseSchema.parse(
        await success(
          await options.fetch(new URL(learningItemHttpRoutes.create, options.apiOrigin), {
            body: JSON.stringify(request),
            credentials: "include",
            headers: {
              "content-type": "application/json",
              ...headers,
              "x-csrf-token": await options.csrfToken(),
            },
            method: "POST",
          }),
        ),
      );
    },
    async getLearningItem(id: string) {
      const path = itemPath(learningItemHttpRoutes.detail, id);
      return learningItemDetailResponseSchema.parse(
        await success(
          await options.fetch(new URL(path, options.apiOrigin), { credentials: "include" }),
        ),
      );
    },
    async listLearningItems(input: ListLearningItemsQuery) {
      const query = listLearningItemsQuerySchema.parse(input);
      const endpoint = new URL(learningItemHttpRoutes.list, options.apiOrigin);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) endpoint.searchParams.set(key, String(value));
      }
      return learningItemListResponseSchema.parse(
        await success(await options.fetch(endpoint, { credentials: "include" })),
      );
    },
    async patchLearningItem(id: string, input: PatchLearningItemRequest, idempotencyKey: string) {
      const request = patchLearningItemRequestSchema.parse(input);
      const headers = learningItemMutationHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
        "if-match": `"${request.expectedRevision}"`,
      });
      return learningItemDetailResponseSchema.parse(
        await jsonRequest(itemPath(learningItemHttpRoutes.patch, id), "PATCH", request, headers),
      );
    },
    async deleteLearningItem(id: string, input: DeleteLearningItemRequest, idempotencyKey: string) {
      const request = deleteLearningItemRequestSchema.parse(input);
      const headers = learningItemMutationHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
        "if-match": `"${request.expectedRevision}"`,
      });
      return deleteLearningItemResponseSchema.parse(
        await jsonRequest(itemPath(learningItemHttpRoutes.delete, id), "DELETE", request, headers),
      );
    },
    async suggestLearningItemDuplicates(
      id: string,
      input: DuplicateSuggestionsRequest,
      idempotencyKey: string,
    ) {
      const request = duplicateSuggestionsRequestSchema.parse(input);
      const headers = duplicateSuggestionsHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
      });
      return duplicateSuggestionsResponseSchema.parse(
        await jsonRequest(
          itemPath(learningItemHttpRoutes.duplicateSuggestions, id),
          "POST",
          request,
          headers,
        ),
      );
    },
    async previewLearningItemMerge(id: string, input: MergeLearningItemsRequest) {
      const request = mergeLearningItemsRequestSchema.parse(input);
      return mergePreviewResponseSchema.parse(
        await jsonRequest(itemPath(learningItemHttpRoutes.mergePreview, id), "POST", request),
      );
    },
    async restoreLearningItem(
      id: string,
      input: LearningItemArchiveRequest,
      idempotencyKey: string,
    ) {
      const request = learningItemArchiveRequestSchema.parse(input);
      const headers = learningItemMutationHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
        "if-match": `"${request.expectedRevision}"`,
      });
      return learningItemDetailResponseSchema.parse(
        await jsonRequest(itemPath(learningItemHttpRoutes.restore, id), "POST", request, headers),
      );
    },
    async confirmLearningItemMerge(
      id: string,
      input: MergeLearningItemsRequest,
      idempotencyKey: string,
    ) {
      const request = mergeLearningItemsRequestSchema.parse(input);
      const headers = learningItemMutationHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
        "if-match": `"${request.sourceRevision}"`,
      });
      return learningItemMergeResponseSchema.parse(
        await jsonRequest(
          itemPath(learningItemHttpRoutes.mergeConfirm, id),
          "POST",
          request,
          headers,
        ),
      );
    },
  };
}
export type WebLearningLibraryApi = ReturnType<typeof createWebLearningLibraryApi>;
