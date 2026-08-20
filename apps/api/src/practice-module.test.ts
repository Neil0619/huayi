import { describe, expect, it, vi } from "vitest";

import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import { createPracticeModule, type PracticeRepository } from "./practice-module.js";

const item = {
  item: {
    content: {
      meaningZh: "坦率地说",
      text: "to be frank",
      type: "expression" as const,
      usageZh: "用于直接表达意见。",
    },
    id: "item-1",
    systemAttributes: ["spoken"],
    tags: ["Writing"],
    type: "expression" as const,
  },
  schedule: { consecutiveMastered: 0, dueAt: null, level: -1 as const },
};

function session(status: "active" | "awaiting-feedback" | "completed", revision: number) {
  return practiceSessionResponseSchema.parse({
    ...(status === "awaiting-feedback" || status === "completed"
      ? {
          attempts: [
            {
              answer: "To be frank, I disagree.",
              ...(status === "completed" ? { feedback: "准确、自然；可继续保持简洁。" } : {}),
              id: "attempt-1",
              itemIds: ["item-1"],
              submittedAt: "2026-08-13T03:00:00.000Z",
            },
          ],
        }
      : {}),
    createdAt: "2026-08-13T02:00:00.000Z",
    ...(status === "completed" ? { finalFeedback: "准确、自然；可继续保持简洁。" } : {}),
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: item.schedule }],
    prompt: "请用这个表达写一句委婉但明确的意见。",
    revision,
    status,
    turns: [],
    type: "sentence-creation",
    updatedAt: "2026-08-13T03:00:00.000Z",
  });
}

function pendingSentence() {
  return practiceSessionResponseSchema.parse({
    createdAt: "2026-08-13T02:00:00.000Z",
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: item.schedule }],
    pendingGeneration: "sentence-prompt",
    revision: 1,
    status: "awaiting-feedback",
    turns: [],
    type: "sentence-creation",
    updatedAt: "2026-08-13T02:00:00.000Z",
  });
}

function repository(overrides: Partial<PracticeRepository> = {}): PracticeRepository {
  return {
    beginSentence: vi.fn(async () => ({
      claimed: true,
      generationId: "generation-1",
      item,
      leaseToken: "lease-1",
      session: pendingSentence(),
    })),
    beginFeedbackRetry: vi.fn(async () => ({
      claimed: true,
      generationId: "generation-1",
      item,
      leaseToken: "lease-1",
      session: session("awaiting-feedback", 2),
    })),
    completeFeedback: vi.fn(async () => session("completed", 3)),
    completeSentencePrompt: vi.fn(async () => session("active", 2)),
    dailyQueue: vi.fn(async () => ({
      currentItems: [],
      currentSession: null,
      dailyGoal: 1,
      date: "2026-08-13",
      items: [item],
      timezone: "Asia/Shanghai",
    })),
    findPracticeItem: vi.fn(async () => item),
    releaseFeedbackLease: vi.fn(async () => undefined),
    releaseSentencePromptLease: vi.fn(async () => undefined),
    rate: vi.fn(async () => session("completed", 4)),
    recordAttempt: vi.fn(async () => ({
      claimed: true,
      generationId: "generation-1",
      item,
      leaseToken: "lease-1",
      session: session("awaiting-feedback", 2),
    })),
    ...overrides,
  };
}

describe("minimal sentence practice module", () => {
  it("projects a strict server-selected daily queue", async () => {
    const store = repository();
    const module = createPracticeModule({
      generator: { generate: vi.fn() },
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });
    await expect(module.dailyQueue("user-a", {})).resolves.toMatchObject({
      items: [{ item: { id: "item-1" } }],
    });
  });

  it("persists an attempt before feedback and never auto-calls the model on replay", async () => {
    const order: string[] = [];
    const store = repository({
      completeFeedback: vi.fn(async () => {
        order.push("feedback-persisted");
        return session("completed", 3);
      }),
      recordAttempt: vi.fn(async () => {
        order.push("answer-persisted");
        return {
          claimed: true,
          generationId: "generation-1",
          item,
          leaseToken: "lease-1",
          session: session("awaiting-feedback", 2),
        };
      }),
    });
    const generator = {
      generate: vi.fn(async () => {
        order.push("model-called");
        return { feedback: "准确、自然；可继续保持简洁。", kind: "sentence-feedback" as const };
      }),
    };
    const module = createPracticeModule({
      generator,
      id: () => "attempt-1",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });
    await module.submitAttempt("user-a", "session-1", "attempt-key", {
      answer: "To be frank, I disagree.",
      expectedRevision: 1,
    });
    expect(order).toEqual(["answer-persisted", "model-called", "feedback-persisted"]);

    vi.mocked(store.recordAttempt).mockResolvedValueOnce({
      claimed: false,
      item,
      session: session("awaiting-feedback", 2),
    });
    await module.submitAttempt("user-a", "session-1", "attempt-key", {
      answer: "To be frank, I disagree.",
      expectedRevision: 1,
    });
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });

  it("persists a pending sentence session before generating its paid prompt", async () => {
    const order: string[] = [];
    const store = repository({
      beginSentence: vi.fn(async () => {
        order.push("session-persisted");
        return {
          claimed: true,
          generationId: "generation-1",
          item,
          leaseToken: "lease-1",
          session: pendingSentence(),
        };
      }),
    });
    const generator = {
      generate: vi.fn(async () => {
        order.push("generator-called");
        return { kind: "sentence-prompt" as const, prompt: "请造句。" };
      }),
    };
    const module = createPracticeModule({
      generator,
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });

    await module.startSentence("user-a", "start-key", { itemId: "item-1" });

    expect(order).toEqual(["session-persisted", "generator-called"]);
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "generation-1",
        kind: "sentence-prompt",
        leaseToken: "lease-1",
        ownerUserId: "user-a",
      }),
    );
    expect(store.completeSentencePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "generation-1", prompt: "请造句。" }),
    );
  });

  it("uses an explicit retry for pending feedback and delegates one atomic rating", async () => {
    const store = repository();
    const module = createPracticeModule({
      generator: {
        generate: vi.fn(async () => ({
          feedback: "准确、自然；可继续保持简洁。",
          kind: "sentence-feedback" as const,
        })),
      },
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });
    await module.retryFeedback("user-a", "session-1", "attempt-1", "retry-key", {
      expectedRevision: 2,
    });
    expect(store.completeFeedback).toHaveBeenCalled();
    await module.rate("user-a", "session-1", "rating-key", {
      expectedRevision: 3,
      ratings: [{ itemId: "item-1", rating: "mastered" }],
    });
    expect(store.rate).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "rating-key", ownerUserId: "user-a" }),
    );
  });

  it("keeps the persisted attempt pending when durable generation does not complete", async () => {
    const store = repository();
    const module = createPracticeModule({
      generator: { generate: vi.fn(async () => null) },
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });
    await expect(
      module.submitAttempt("user-a", "session-1", "attempt-key", {
        answer: "To be frank, I disagree.",
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ status: "awaiting-feedback" });
    expect(store.releaseFeedbackLease).not.toHaveBeenCalled();
  });
});
