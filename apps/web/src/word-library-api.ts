import {
  apiErrorSchema,
  deleteWordEntryRequestSchema,
  deleteWordEntryResponseSchema,
  listWordEntriesQuerySchema,
  patchWordEntryRequestSchema,
  patchWordEntryResponseSchema,
  upsertWordRequestSchema,
  upsertWordResponseSchema,
  wordEntryCreateHeadersSchema,
  wordEntryDetailQuerySchema,
  wordEntryDetailResponseSchema,
  wordEntryHttpRoutes,
  wordEntryListResponseSchema,
  wordEntryMutationHeadersSchema,
  type ApiError,
  type DeleteWordEntryRequest,
  type ListWordEntriesQuery,
  type PatchWordEntryRequest,
  type WordEntryDetailQuery,
  type UpsertWordRequest,
} from "@huayi/cloud-contracts";

export class WebWordLibraryApiError extends Error {
  constructor(readonly code: ApiError["error"]["code"] | "unknown") {
    super("Huayi word library request failed.");
  }
}

export function createWebWordLibraryApi(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const success = async (response: Response) => {
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new WebWordLibraryApiError(parsed.success ? parsed.data.error.code : "unknown");
    }
    return response.json() as Promise<unknown>;
  };
  const path = (id: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(id)) throw new Error("Invalid word id.");
    return wordEntryHttpRoutes.detail.replace(":id", encodeURIComponent(id));
  };
  const query = (route: string, input: Record<string, unknown>) => {
    const endpoint = new URL(route, options.apiOrigin);
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) endpoint.searchParams.set(key, String(value));
    }
    return endpoint;
  };
  const mutate = async (
    id: string,
    method: "DELETE" | "PATCH",
    request: { expectedRevision: number },
    key: string,
  ) => {
    const headers = wordEntryMutationHeadersSchema.parse({
      "idempotency-key": key,
      "if-match": `"${request.expectedRevision}"`,
    });
    return success(
      await options.fetch(new URL(path(id), options.apiOrigin), {
        body: JSON.stringify(request),
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...headers,
          "x-csrf-token": await options.csrfToken(),
        },
        method,
      }),
    );
  };
  return {
    async deleteWord(id: string, input: DeleteWordEntryRequest, key: string) {
      const request = deleteWordEntryRequestSchema.parse(input);
      return deleteWordEntryResponseSchema.parse(await mutate(id, "DELETE", request, key));
    },
    async getWord(id: string, input: WordEntryDetailQuery) {
      const request = wordEntryDetailQuerySchema.parse(input);
      return wordEntryDetailResponseSchema.parse(
        await success(await options.fetch(query(path(id), request), { credentials: "include" })),
      );
    },
    async listWords(input: ListWordEntriesQuery) {
      const request = listWordEntriesQuerySchema.parse(input);
      return wordEntryListResponseSchema.parse(
        await success(
          await options.fetch(query(wordEntryHttpRoutes.list, request), {
            credentials: "include",
          }),
        ),
      );
    },
    async patchWord(id: string, input: PatchWordEntryRequest, key: string) {
      const request = patchWordEntryRequestSchema.parse(input);
      return patchWordEntryResponseSchema.parse(await mutate(id, "PATCH", request, key));
    },
    async upsertWord(input: UpsertWordRequest, key: string) {
      const request = upsertWordRequestSchema.parse(input);
      const headers = wordEntryCreateHeadersSchema.parse({ "idempotency-key": key });
      return upsertWordResponseSchema.parse(
        await success(
          await options.fetch(new URL(wordEntryHttpRoutes.create, options.apiOrigin), {
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
  };
}

export type WebWordLibraryApi = ReturnType<typeof createWebWordLibraryApi>;
