import { expect, it, vi } from "vitest";
import { createLearningTaskClient } from "./learning-task-client.js";
import { createStructuredLearningTaskClient } from "./structured-task-client.js";

it.each([
  ["legacy", createLearningTaskClient],
  ["native", createStructuredLearningTaskClient],
] as const)(
  "binds known-task %s JSON reads and cancellation to their URL identity",
  async (_mode, create) => {
    const request = vi.fn(async () =>
      Response.json({
        version: 2,
        id: "20000000-0000-4000-8000-000000000002",
        kind: "instant-query",
        subjectId: null,
        state: "cancelled",
        cursor: 0,
        error: null,
        output: null,
        timings: {},
        createdAt: "2026-09-13T00:00:00Z",
        updatedAt: "2026-09-13T00:00:00Z",
      }),
    );
    const client = create({ request });
    const id = "10000000-0000-4000-8000-000000000001";
    await expect(client.get(id)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(client.cancel(id)).rejects.toMatchObject({ code: "invalid_response" });
    expect(request).toHaveBeenCalledTimes(2);
  },
);
