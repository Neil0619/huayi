import { describe, expect, it, vi } from "vitest";

import { createWebPracticeApi } from "./practice-api.js";

describe("Web practice API", () => {
  it("uses fixed Cookie GET and strict CSRF/revision mutation requests", async () => {
    const queue = {
      currentItems: [],
      currentSession: null,
      dailyGoal: 1,
      date: "2026-08-13",
      items: [],
      timezone: "UTC",
    };
    const session = {
      createdAt: "2026-08-13T03:00:00.000Z",
      id: "session-1",
      items: [
        {
          itemId: "item-1",
          position: 0,
          scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      prompt: "请造句。",
      revision: 1,
      status: "active",
      turns: [],
      type: "sentence-creation",
      updatedAt: "2026-08-13T03:00:00.000Z",
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(queue))
      .mockResolvedValueOnce(Response.json(session, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ ...session, revision: 2, status: "awaiting-feedback" }),
      );
    const api = createWebPracticeApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf-proof",
      fetch,
    });
    await api.dailyQueue();
    await api.startSentence("item-1", "start-1");
    await api.submitAttempt(
      "session-1",
      { answer: "My sentence.", expectedRevision: 1 },
      "attempt-1",
    );
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.huayi.invalid/v2/practice/daily-queue",
    );
    expect(fetch.mock.calls[0]?.[1]).toEqual({ credentials: "include" });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": "attempt-1",
        "if-match": '"1"',
        "x-csrf-token": "csrf-proof",
      }),
      method: "POST",
    });
  });

  it("rejects invalid ids and inputs before fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createWebPracticeApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf",
      fetch,
    });
    await expect(api.startSentence("bad/id", "key")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses only fixed dialogue routes and rejects duplicate learning item ids", async () => {
    const session = {
      createdAt: "2026-08-13T03:00:00.000Z",
      dialoguePlan: {
        endConditionZh: "确认下一步。",
        roleZh: "你是项目成员。",
        taskZh: "讨论两个计划。",
      },
      id: "session-1",
      items: [
        {
          itemId: "item-1",
          position: 0,
          scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      prompt: "完成受约束对话。",
      revision: 1,
      status: "active",
      turns: [
        {
          content: "Which plan do you prefer?",
          createdAt: "2026-08-13T03:00:00.000Z",
          id: "turn-1",
          ordinal: 0,
          role: "assistant",
        },
      ],
      type: "dialogue",
      updatedAt: "2026-08-13T03:00:00.000Z",
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(session, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({
          ...session,
          pendingGeneration: "assistant-turn",
          revision: 2,
          status: "awaiting-feedback",
          turns: [
            ...session.turns,
            {
              content: "To be frank, plan B.",
              createdAt: "2026-08-13T03:01:00.000Z",
              id: "turn-2",
              ordinal: 1,
              role: "user",
            },
          ],
        }),
      );
    const api = createWebPracticeApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf",
      fetch,
    });
    await api.startDialogue(["item-1"], "dialogue-start");
    await api.submitTurn(
      "session-1",
      { content: "To be frank, plan B.", expectedRevision: 1 },
      "dialogue-turn",
    );
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.huayi.invalid/v2/practice/dialogue-sessions",
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      "https://api.huayi.invalid/v2/practice/sessions/session-1/turns",
    );
    await expect(api.startDialogue(["item-1", "item-1"], "duplicate")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses fixed history list/detail and strict delete requests", async () => {
    const detail = {
      completedAt: "2026-08-13T05:05:00.000Z",
      itemLabels: [{ itemId: "item-1", label: "to be frank" }],
      session: {
        attempts: [
          {
            answer: "My sentence.",
            feedback: "Good.",
            id: "attempt-1",
            itemIds: ["item-1"],
            submittedAt: "2026-08-13T05:04:00.000Z",
          },
        ],
        createdAt: "2026-08-13T05:00:00.000Z",
        finalFeedback: "Good.",
        id: "session-1",
        items: [
          {
            itemId: "item-1",
            position: 0,
            scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
          },
        ],
        prompt: "Write.",
        revision: 2,
        status: "completed",
        turns: [],
        type: "sentence-creation",
        updatedAt: "2026-08-13T05:05:00.000Z",
      },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(Response.json({ deleted: true, id: "session-1" }));
    const api = createWebPracticeApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf-proof",
      fetch,
    });
    await api.listPracticeHistory({ limit: 10, status: "completed" });
    await api.getPracticeHistory("session-1");
    await api.deletePracticeHistory("session-1", { expectedRevision: 2 }, "delete-1");
    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/v2/practice/sessions",
      "/v2/practice/sessions/session-1",
      "/v2/practice/sessions/session-1",
    ]);
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": "delete-1",
        "if-match": '"2"',
        "x-csrf-token": "csrf-proof",
      }),
      method: "DELETE",
    });
  });
});
