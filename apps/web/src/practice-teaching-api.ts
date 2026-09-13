import {
  apiErrorSchema,
  idempotencyKeySchema,
  LearningTaskError,
  practiceTeachingActionSchema,
  practiceTeachingDetailSchema,
  resourceIdSchema,
  type PracticeTeachingAction,
} from "@huayi/cloud-contracts";

export function createWebPracticeTeaching(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const request = async (id: string, action?: { input: PracticeTeachingAction; key: string }) => {
    const sessionId = resourceIdSchema.parse(id);
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(sessionId))
      throw new LearningTaskError("invalid_request");
    const response = await options.fetch(
      new URL(
        `/v2/practice/sessions/${encodeURIComponent(sessionId)}/${action ? "teaching-actions" : "teaching"}`,
        options.apiOrigin,
      ),
      {
        credentials: "include",
        method: action ? "POST" : "GET",
        ...(action
          ? {
              body: JSON.stringify(practiceTeachingActionSchema.parse(action.input)),
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
    const detail = practiceTeachingDetailSchema.parse(value);
    if (detail.session.id !== sessionId) throw new LearningTaskError("invalid_response");
    return detail;
  };
  return {
    get: (id: string) => request(id),
    act: (id: string, input: PracticeTeachingAction, key: string) => request(id, { input, key }),
  };
}
export type WebPracticeTeaching = ReturnType<typeof createWebPracticeTeaching>;
