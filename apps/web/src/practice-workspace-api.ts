import {
  apiErrorSchema,
  practiceSessionResponseSchema,
  practiceWorkspaceStartSchema,
  practiceWorkspaceControlSchema,
  practiceWorkspaceDraftSchema,
  resourceIdSchema,
  type PracticeWorkspaceStart,
  type PracticeWorkspaceControl,
  type PracticeWorkspaceDraft,
} from "@huayi/cloud-contracts";
import { z } from "zod/v3";
import { LearningTaskError } from "@huayi/cloud-contracts";
export function createWebPracticeWorkspace(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const request = async (path: string, input?: unknown, key?: string) => {
    const response = await options.fetch(
      new URL(`/v2/practice-workspace${path}`, options.apiOrigin),
      {
        credentials: "include",
        method: input === undefined ? "GET" : "POST",
        ...(input === undefined
          ? {}
          : {
              body: JSON.stringify(input),
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": await options.csrfToken(),
                ...(key ? { "Idempotency-Key": key } : {}),
              },
            }),
      },
    );
    const json: unknown = await response.json();
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(json);
      throw new LearningTaskError(parsed.success ? parsed.data.error.code : "network_error");
    }
    return json;
  };
  const path = (id: string) => `/${encodeURIComponent(resourceIdSchema.parse(id))}`;
  return {
    async start(input: PracticeWorkspaceStart, key: string) {
      return practiceSessionResponseSchema.parse(
        await request("/start", practiceWorkspaceStartSchema.parse(input), key),
      );
    },
    async get(id: string) {
      return practiceSessionResponseSchema.parse(await request(path(id)));
    },
    async list() {
      return z
        .array(practiceSessionResponseSchema)
        .max(20)
        .parse(await request(""));
    },
    async draft(id: string, input: PracticeWorkspaceDraft) {
      return practiceSessionResponseSchema.parse(
        await request(`${path(id)}/draft`, practiceWorkspaceDraftSchema.parse(input)),
      );
    },
    async control(id: string, input: PracticeWorkspaceControl, key: string) {
      return practiceSessionResponseSchema.parse(
        await request(`${path(id)}/control`, practiceWorkspaceControlSchema.parse(input), key),
      );
    },
  };
}
export type WebPracticeWorkspace = ReturnType<typeof createWebPracticeWorkspace>;
