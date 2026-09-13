import {
  apiErrorSchema,
  idempotencyKeySchema,
  LearningTaskError,
  practiceReferenceDetailSchema,
  practiceReferenceRequestSchema,
  resourceIdSchema,
  type PracticeReferenceRequest,
} from "@huayi/cloud-contracts";

export function createWebPracticeReference(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const request = async (id: string, action?: { input: PracticeReferenceRequest; key: string }) => {
    const sessionId = resourceIdSchema.parse(id);
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(sessionId))
      throw new LearningTaskError("invalid_request");
    const response = await options.fetch(
      new URL(
        `/v2/practice/sessions/${encodeURIComponent(sessionId)}/reference${action ? "/reveal" : ""}`,
        options.apiOrigin,
      ),
      {
        credentials: "include",
        method: action ? "POST" : "GET",
        ...(action
          ? {
              body: JSON.stringify(practiceReferenceRequestSchema.parse(action.input)),
              headers: {
                "content-type": "application/json",
                "idempotency-key": idempotencyKeySchema.parse(action.key),
                "x-csrf-token": await options.csrfToken(),
              },
            }
          : {}),
      },
    );
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = apiErrorSchema.safeParse(value);
      throw new LearningTaskError(error.success ? error.data.error.code : "network_error");
    }
    const detail = practiceReferenceDetailSchema.parse(value);
    if (detail.sessionId !== sessionId) throw new LearningTaskError("invalid_response");
    return detail;
  };
  return {
    get: (id: string) => request(id),
    reveal: (id: string, input: PracticeReferenceRequest, key: string) =>
      request(id, { input, key }),
  };
}
export type WebPracticeReference = ReturnType<typeof createWebPracticeReference>;
