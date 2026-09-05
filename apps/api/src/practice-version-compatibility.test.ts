import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import { createPracticeApp } from "./practice-app.js";

const queueItem = {
  item: {
    id: "item-1",
    type: "expression" as const,
    content: {
      type: "expression" as const,
      text: "at least",
      meaningZh: "至少",
      usageZh: "下限。",
    },
    systemAttributes: [],
    tags: [],
  },
  schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
};
const session = practiceSessionResponseSchema.parse({
  createdAt: "2026-09-05T03:00:00.000Z",
  updatedAt: "2026-09-05T03:00:00.000Z",
  id: "session-1",
  revision: 1,
  items: [{ itemId: "item-1", position: 0, scheduleBefore: queueItem.schedule }],
  pendingGeneration: "sentence-prompt",
  status: "awaiting-feedback",
  turns: [],
  type: "sentence-creation",
  workspace: { phase: "active", mode: "guided", draft: "My draft", draftRevision: 1 },
});

function fixture() {
  const reply = vi.fn<(owner: string, ...arguments_: unknown[]) => Promise<typeof session>>(
    async () => session,
  );
  const authenticate = vi.fn(() => "user-a");
  const app = new Hono().route(
    "/",
    createPracticeApp({
      authenticate,
      module: {
        dailyQueue: async () => ({
          completedToday: 2,
          currentItems: [queueItem],
          currentSession: session,
          dailyGoal: 5,
          date: "2026-09-05",
          items: [queueItem],
          timezone: "UTC",
        }),
        startSentence: reply,
        submitAttempt: reply,
        retryFeedback: reply,
        rate: reply,
      },
      dialogueModule: {
        startDialogue: reply,
        submitTurn: reply,
        retryAssistant: reply,
        finish: reply,
      },
      historyModule: {
        delete: async () => ({ deleted: true, id: session.id }),
        get: async () => ({
          completedAt: null,
          itemLabels: [{ itemId: "item-1", label: "at least" }],
          session,
        }),
        list: async () => ({
          items: [
            {
              completedAt: null,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              id: session.id,
              revision: session.revision,
              items: [{ itemId: "item-1" }],
              status: session.status,
              type: session.type,
              workspacePhase: "active",
            },
          ],
          nextCursor: null,
        }),
      },
    }),
  );
  return { app, authenticate, reply };
}

describe("practice response version compatibility", () => {
  it.each(["v1", "v2"])(
    "serves %s queues without changing the persisted session",
    async (version) => {
      const { app, authenticate } = fixture();
      const response = await app.request(`/${version}/practice/daily-queue`);
      expect(response.status).toBe(200);
      const queue = await response.json();
      if (version === "v1") {
        // These are the exact top-level keys accepted by the previous strict Web client.
        expect(Object.keys(queue).sort()).toEqual([
          "currentItems",
          "currentSession",
          "dailyGoal",
          "date",
          "items",
          "timezone",
        ]);
        expect(queue.currentSession).not.toHaveProperty("workspace");
      } else {
        expect(queue.completedToday).toBe(2);
        expect(queue.currentSession.workspace).toEqual(session.workspace);
      }
      expect(queue.currentSession.pendingGeneration).toBe("sentence-prompt");
      expect(session.workspace?.draft).toBe("My draft");
      expect(authenticate).toHaveBeenCalledOnce();
    },
  );

  it.each(["v1", "v2"])(
    "versions %s history list and detail at the response boundary",
    async (version) => {
      const { app } = fixture();
      const list = await app.request(`/${version}/practice/sessions`);
      const detail = await app.request(`/${version}/practice/sessions/session-1`);
      expect([list.status, detail.status]).toEqual([200, 200]);
      const listBody = await list.json();
      const detailBody = await detail.json();
      if (version === "v1") {
        expect(listBody.items[0]).not.toHaveProperty("workspacePhase");
        expect(detailBody.session).not.toHaveProperty("workspace");
      } else {
        expect(listBody.items[0].workspacePhase).toBe("active");
        expect(detailBody.session.workspace).toEqual(session.workspace);
      }
    },
  );

  it.each(["v1", "v2"])(
    "preserves %s mutation guards and versions every session reply",
    async (version) => {
      const { app, reply } = fixture();
      const cases = [
        ["sentence-sessions", { itemId: "item-1" }, 201],
        ["dialogue-sessions", { itemIds: ["item-1"] }, 201],
        ["sessions/session-1/turns", { content: "My reply", expectedRevision: 1 }, 200],
        ["sessions/session-1/attempts", { answer: "My answer", expectedRevision: 1 }, 200],
        ["sessions/session-1/attempts/attempt-1/retry-feedback", { expectedRevision: 1 }, 200],
        ["sessions/session-1/retry-assistant-turn", { expectedRevision: 1 }, 200],
        ["sessions/session-1/finish", { expectedRevision: 1 }, 200],
        [
          "sessions/session-1/ratings",
          { expectedRevision: 1, ratings: [{ itemId: "item-1", rating: "effortful" }] },
          200,
        ],
      ] as const;
      for (const [path, input, status] of cases) {
        const response = await app.request(`/${version}/practice/${path}`, {
          method: "POST",
          body: JSON.stringify(input),
          headers: {
            "content-type": "application/json",
            "idempotency-key": "operation-1",
            "if-match": '"1"',
          },
        });
        expect(response.status).toBe(status);
        const body = await response.json();
        if (version === "v1") expect(body).not.toHaveProperty("workspace");
        else expect(body.workspace).toEqual(session.workspace);
      }
      expect(reply).toHaveBeenCalledTimes(cases.length);
      expect(reply.mock.calls.every((call) => call[0] === "user-a")).toBe(true);
    },
  );
});
