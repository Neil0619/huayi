import { createWebPracticeWorkspace } from "./practice-workspace-api.js";
import { createWebLearningTasks } from "./learning-task-api.js";
import {
  apiErrorSchema,
  dailyPracticeQueueResponseSchema,
  dailyQueueQuerySchema,
  deletePracticeSessionRequestSchema,
  deletePracticeSessionResponseSchema,
  finishPracticeSessionRequestSchema,
  practiceHttpRoutes,
  practiceHistoryDetailResponseSchema,
  practiceHistoryListResponseSchema,
  practiceRatingsRequestSchema,
  practiceSessionResponseSchema,
  retryDialogueAssistantRequestSchema,
  retryPracticeFeedbackRequestSchema,
  listPracticeSessionsQuerySchema,
  type ListPracticeSessionsQuery,
  startDialogueSessionRequestSchema,
  startSentenceSessionRequestSchema,
  submitDialogueTurnRequestSchema,
  submitPracticeAttemptRequestSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

export class WebPracticeApiError extends Error {
  constructor(readonly code: ApiError["error"]["code"] | "unknown") {
    super("Huayi practice request failed.");
  }
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u;
function id(value: string) {
  if (!idPattern.test(value)) throw new Error("Invalid practice resource id.");
  return value;
}

export function createWebPracticeApi(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const success = async (response: Response) => {
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new WebPracticeApiError(parsed.success ? parsed.data.error.code : "unknown");
    }
    return response.json() as Promise<unknown>;
  };
  const mutate = async (path: string, input: unknown, key: string, revision?: number) =>
    practiceSessionResponseSchema.parse(
      await success(
        await options.fetch(new URL(path, options.apiOrigin), {
          body: JSON.stringify(input),
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
            ...(revision === undefined ? {} : { "if-match": `"${revision}"` }),
            "x-csrf-token": await options.csrfToken(),
          },
          method: "POST",
        }),
      ),
    );
  const deleteMutation = async (path: string, input: unknown, key: string, revision: number) =>
    deletePracticeSessionResponseSchema.parse(
      await success(
        await options.fetch(new URL(path, options.apiOrigin), {
          body: JSON.stringify(input),
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
            "if-match": `"${revision}"`,
            "x-csrf-token": await options.csrfToken(),
          },
          method: "DELETE",
        }),
      ),
    );
  return {
    tasks: createWebLearningTasks(options),
    workspace: createWebPracticeWorkspace(options),
    async dailyQueue() {
      dailyQueueQuerySchema.parse({});
      const endpoint = new URL(practiceHttpRoutes.dailyQueue, options.apiOrigin);
      return dailyPracticeQueueResponseSchema.parse(
        await success(await options.fetch(endpoint, { credentials: "include" })),
      );
    },
    async finish(sessionId: string, input: { expectedRevision: number }, key: string) {
      const request = finishPracticeSessionRequestSchema.parse(input);
      const path = practiceHttpRoutes.finish.replace(":id", encodeURIComponent(id(sessionId)));
      return mutate(path, request, key, request.expectedRevision);
    },
    async deletePracticeHistory(
      sessionId: string,
      input: { expectedRevision: number },
      key: string,
    ) {
      const request = deletePracticeSessionRequestSchema.parse(input);
      const path = practiceHttpRoutes.historyDelete.replace(
        ":id",
        encodeURIComponent(id(sessionId)),
      );
      return deleteMutation(path, request, key, request.expectedRevision);
    },
    async getPracticeHistory(sessionId: string) {
      const path = practiceHttpRoutes.historyDetail.replace(
        ":id",
        encodeURIComponent(id(sessionId)),
      );
      return practiceHistoryDetailResponseSchema.parse(
        await success(
          await options.fetch(new URL(path, options.apiOrigin), { credentials: "include" }),
        ),
      );
    },
    async listPracticeHistory(input: ListPracticeSessionsQuery) {
      const query = listPracticeSessionsQuerySchema.parse(input);
      const endpoint = new URL(practiceHttpRoutes.historyList, options.apiOrigin);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) endpoint.searchParams.set(key, String(value));
      }
      return practiceHistoryListResponseSchema.parse(
        await success(await options.fetch(endpoint, { credentials: "include" })),
      );
    },
    async rate(
      sessionId: string,
      input: { expectedRevision: number; ratings: { itemId: string; rating: string }[] },
      key: string,
    ) {
      const request = practiceRatingsRequestSchema.parse(input);
      const path = practiceHttpRoutes.rate.replace(":id", encodeURIComponent(id(sessionId)));
      return mutate(path, request, key, request.expectedRevision);
    },
    async retryFeedback(
      sessionId: string,
      attemptId: string,
      input: { expectedRevision: number },
      key: string,
    ) {
      const request = retryPracticeFeedbackRequestSchema.parse(input);
      const path = practiceHttpRoutes.retryFeedback
        .replace(":attemptId", encodeURIComponent(id(attemptId)))
        .replace(":id", encodeURIComponent(id(sessionId)));
      return mutate(path, request, key, request.expectedRevision);
    },
    async retryAssistant(sessionId: string, input: { expectedRevision: number }, key: string) {
      const request = retryDialogueAssistantRequestSchema.parse(input);
      const path = practiceHttpRoutes.retryAssistant.replace(
        ":id",
        encodeURIComponent(id(sessionId)),
      );
      return mutate(path, request, key, request.expectedRevision);
    },
    async startDialogue(itemIds: string[], key: string) {
      const request = startDialogueSessionRequestSchema.parse({ itemIds: itemIds.map(id) });
      return mutate(practiceHttpRoutes.startDialogue, request, key);
    },
    async startSentence(itemId: string, key: string) {
      const request = startSentenceSessionRequestSchema.parse({ itemId: id(itemId) });
      return mutate(practiceHttpRoutes.startSentence, request, key);
    },
    async submitAttempt(
      sessionId: string,
      input: { answer: string; expectedRevision: number },
      key: string,
    ) {
      const request = submitPracticeAttemptRequestSchema.parse(input);
      const path = practiceHttpRoutes.submitAttempt.replace(
        ":id",
        encodeURIComponent(id(sessionId)),
      );
      return mutate(path, request, key, request.expectedRevision);
    },
    async submitTurn(
      sessionId: string,
      input: { content: string; expectedRevision: number },
      key: string,
    ) {
      const request = submitDialogueTurnRequestSchema.parse(input);
      const path = practiceHttpRoutes.submitTurn.replace(":id", encodeURIComponent(id(sessionId)));
      return mutate(path, request, key, request.expectedRevision);
    },
  };
}

export type WebPracticeApi = ReturnType<typeof createWebPracticeApi>;
