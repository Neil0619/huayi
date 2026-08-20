import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import { createPracticeApp } from "./practice-app.js";
import type { DialoguePracticeModule } from "./dialogue-practice-module.js";
import { createPracticeModule, type PracticeRepository } from "./practice-module.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createPracticeHistoryModule } from "./practice-history-module.js";

function app() {
  const queueItem = {
    item: {
      content: {
        meaningZh: "因此",
        text: "as a result",
        type: "expression" as const,
        usageZh: "结果。",
      },
      id: "item-1",
      systemAttributes: [],
      tags: [],
      type: "expression" as const,
    },
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 as const },
  };
  const session = {
    createdAt: "2026-08-13T03:00:00.000Z",
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: queueItem.schedule }],
    prompt: "请造句。",
    revision: 1,
    status: "active" as const,
    turns: [],
    type: "sentence-creation" as const,
    updatedAt: "2026-08-13T03:00:00.000Z",
  };
  const repository: PracticeRepository = {
    beginSentence: vi.fn(async () => ({
      claimed: false as const,
      item: queueItem,
      session: practiceSessionResponseSchema.parse(session),
    })),
    beginFeedbackRetry: vi.fn(async () => ({
      claimed: false as const,
      item: queueItem,
      session: practiceSessionResponseSchema.parse({
        ...session,
        attempts: [
          {
            answer: "My answer.",
            id: "attempt-1",
            itemIds: ["item-1"],
            submittedAt: "2026-08-13T03:01:00.000Z",
          },
        ],
        revision: 2,
        status: "awaiting-feedback",
      }),
    })),
    completeFeedback: vi.fn(),
    completeSentencePrompt: vi.fn(),
    dailyQueue: vi.fn(async () => ({
      currentItems: [],
      currentSession: null,
      dailyGoal: 1,
      date: "2026-08-13",
      items: [queueItem],
      timezone: "UTC",
    })),
    findPracticeItem: vi.fn(async () => queueItem),
    releaseFeedbackLease: vi.fn(async () => undefined),
    releaseSentencePromptLease: vi.fn(async () => undefined),
    rate: vi.fn(async () => session),
    recordAttempt: vi.fn(),
  };
  const module = createPracticeModule({
    generator: { generate: vi.fn(async () => null) },
    id: () => "session-1",
    now: () => new Date("2026-08-13T03:00:00.000Z"),
    repository,
  });
  const outer = new Hono();
  outer.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    return context.json(
      { error: { code: fault.code, message: fault.message, requestId: "request-1" } },
      errorStatus(fault.code),
    );
  });
  const unavailable = async () => Promise.reject(new Error("not used"));
  const dialogueModule: DialoguePracticeModule = {
    finish: unavailable,
    retryAssistant: unavailable,
    startDialogue: unavailable,
    submitTurn: unavailable,
  };
  const historyModule = createPracticeHistoryModule({
    cursorKey: new Uint8Array(32).fill(8),
    now: () => new Date("2026-08-13T03:00:00.000Z"),
    repository: {
      delete: async ({ sessionId }) => ({ deleted: true, id: sessionId }),
      findById: async () => null,
      list: async () => ({ hasMore: false, items: [] }),
    },
  });
  outer.route(
    "/",
    createPracticeApp({
      authenticate: () => "user-a",
      dialogueModule,
      historyModule,
      module,
    }),
  );
  return outer;
}

describe("practice HTTP", () => {
  it("serves a strict queue and starts only with idempotency proof", async () => {
    const queue = await app().request("/v1/practice/daily-queue");
    expect(queue.status).toBe(200);
    expect(await queue.json()).toMatchObject({ items: [{ item: { id: "item-1" } }] });
    const started = await app().request("/v1/practice/sentence-sessions", {
      body: JSON.stringify({ itemId: "item-1" }),
      headers: { "content-type": "application/json", "idempotency-key": "start-1" },
      method: "POST",
    });
    expect(started.status).toBe(201);
    const rejected = await app().request("/v1/practice/sentence-sessions", {
      body: JSON.stringify({ itemId: "item-1" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(rejected.status).toBe(400);
  });

  it("requires matching revision headers for session mutations", async () => {
    const response = await app().request("/v1/practice/sessions/session-1/ratings", {
      body: JSON.stringify({
        expectedRevision: 3,
        ratings: [{ itemId: "item-1", rating: "mastered" }],
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "rate-1",
        "if-match": '"2"',
      },
      method: "POST",
    });
    expect(response.status).toBe(400);
    const retry = await app().request(
      "/v1/practice/sessions/session-1/attempts/attempt-1/retry-feedback",
      {
        body: JSON.stringify({ expectedRevision: 2 }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "retry-1",
          "if-match": '"2"',
        },
        method: "POST",
      },
    );
    expect(retry.status).toBe(200);
  });

  it("serves fixed history routes and requires matching delete revision", async () => {
    const list = await app().request("/v1/practice/sessions?status=completed");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [], nextCursor: null });
    const deleted = await app().request("/v1/practice/sessions/session-1", {
      body: JSON.stringify({ expectedRevision: 3 }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "delete-1",
        "if-match": '"3"',
      },
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const mismatch = await app().request("/v1/practice/sessions/session-1", {
      body: JSON.stringify({ expectedRevision: 3 }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "delete-2",
        "if-match": '"2"',
      },
      method: "DELETE",
    });
    expect(mismatch.status).toBe(400);
  });
});
