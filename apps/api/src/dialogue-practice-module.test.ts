import { describe, expect, it, vi } from "vitest";

import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";

import {
  createDialoguePracticeModule,
  type DialoguePracticeRepository,
} from "./dialogue-practice-module.js";

const item = (id: string) => ({
  item: {
    content: {
      meaningZh: "坦率地说",
      text: id === "item-1" ? "to be frank" : "as a result",
      type: "expression" as const,
      usageZh: "用于表达观点。",
    },
    id,
    systemAttributes: [],
    tags: [],
    type: "expression" as const,
  },
  schedule: { consecutiveMastered: 0, dueAt: null, level: -1 as const },
});

function dialogue(status: "active" | "awaiting-feedback" | "completed", revision: number) {
  const turns = [
    {
      content: "Which plan do you prefer?",
      createdAt: "2026-08-13T03:00:00.000Z",
      id: "turn-0",
      ordinal: 0,
      role: "assistant" as const,
    },
    ...(revision >= 2
      ? [
          {
            content: "To be frank, I prefer plan B.",
            createdAt: "2026-08-13T03:01:00.000Z",
            id: "turn-1",
            ordinal: 1,
            role: "user" as const,
          },
        ]
      : []),
    ...(revision >= 3
      ? [
          {
            content: "What result would that have?",
            createdAt: "2026-08-13T03:02:00.000Z",
            id: "turn-2",
            ordinal: 2,
            role: "assistant" as const,
          },
        ]
      : []),
    ...(revision >= 4
      ? [
          {
            content: "As a result, we can ship sooner.",
            createdAt: "2026-08-13T03:03:00.000Z",
            id: "turn-3",
            ordinal: 3,
            role: "user" as const,
          },
          {
            content: "What is the main risk?",
            createdAt: "2026-08-13T03:04:00.000Z",
            id: "turn-4",
            ordinal: 4,
            role: "assistant" as const,
          },
          {
            content: "To be frank, the schedule is tight.",
            createdAt: "2026-08-13T03:05:00.000Z",
            id: "turn-5",
            ordinal: 5,
            role: "user" as const,
          },
          {
            content: "Then we have a plan.",
            createdAt: "2026-08-13T03:06:00.000Z",
            id: "turn-6",
            ordinal: 6,
            role: "assistant" as const,
          },
        ]
      : []),
  ];
  return practiceSessionResponseSchema.parse({
    createdAt: "2026-08-13T03:00:00.000Z",
    dialoguePlan: {
      endConditionZh: "达成下一步。",
      roleZh: "你是项目成员，对方是同事。",
      taskZh: "讨论两个计划。",
    },
    ...(status === "completed"
      ? {
          finalFeedback: "表达清晰。",
          itemFeedbacks: [{ feedback: "使用准确。", itemId: "item-1" }],
        }
      : {}),
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: item("item-1").schedule }],
    ...(status === "awaiting-feedback" ? { pendingGeneration: "assistant-turn" } : {}),
    prompt: "完成一次受约束对话。",
    revision,
    status,
    turns,
    type: "dialogue",
    updatedAt: "2026-08-13T03:02:00.000Z",
  });
}

function pendingStart() {
  return practiceSessionResponseSchema.parse({
    createdAt: "2026-08-13T03:00:00.000Z",
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: item("item-1").schedule }],
    pendingGeneration: "dialogue-start",
    revision: 1,
    status: "awaiting-feedback",
    turns: [],
    type: "dialogue",
    updatedAt: "2026-08-13T03:00:00.000Z",
  });
}

function repository(
  overrides: Partial<DialoguePracticeRepository> = {},
): DialoguePracticeRepository {
  return {
    beginAssistantRetry: vi.fn(async () => ({
      claimed: false as const,
      session: dialogue("awaiting-feedback", 2),
    })),
    beginFinish: vi.fn(async () => ({ claimed: false as const, session: dialogue("active", 3) })),
    completeAssistant: vi.fn(async () => dialogue("active", 3)),
    completeFinish: vi.fn(async () => dialogue("completed", 4)),
    completeStart: vi.fn(async () => dialogue("active", 1)),
    findItems: vi.fn(async () => [item("item-1")]),
    recordUserTurn: vi.fn(async () => ({
      claimed: true as const,
      generationId: "generation-1",
      leaseToken: "lease-1",
      session: dialogue("awaiting-feedback", 2),
    })),
    releaseGenerationLease: vi.fn(async () => undefined),
    reserveStart: vi.fn(async () => ({
      claimed: true as const,
      generationId: "generation-1",
      leaseToken: "lease-1",
      session: pendingStart(),
    })),
    ...overrides,
  };
}

describe("constrained dialogue practice module", () => {
  it("persists a user turn before generating and fences completion", async () => {
    const order: string[] = [];
    const store = repository({
      completeAssistant: vi.fn(async () => {
        order.push("assistant-persisted");
        return dialogue("active", 3);
      }),
      recordUserTurn: vi.fn(async () => {
        order.push("user-persisted");
        return {
          claimed: true as const,
          generationId: "generation-1",
          leaseToken: "lease-1",
          session: dialogue("awaiting-feedback", 2),
        };
      }),
    });
    const generator = {
      generate: vi.fn(async () => {
        order.push("model-called");
        return {
          assistantTurn: "What result would that have?",
          kind: "dialogue-assistant" as const,
        };
      }),
    };
    const module = createDialoguePracticeModule({
      generator,
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });
    await module.submitTurn("user-a", "session-1", "turn-key", {
      content: "To be frank, I prefer plan B.",
      expectedRevision: 1,
    });
    expect(order).toEqual(["user-persisted", "model-called", "assistant-persisted"]);
    expect(store.completeAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ generationLeaseToken: "lease-1" }),
    );
  });

  it("does not call the model for an unclaimed replay and releases failures", async () => {
    const store = repository({
      recordUserTurn: vi.fn(async () => ({
        claimed: false as const,
        session: dialogue("awaiting-feedback", 2),
      })),
    });
    const generate = vi.fn(async () => null);
    const module = createDialoguePracticeModule({
      generator: { generate },
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });
    await expect(
      module.submitTurn("user-a", "session-1", "turn-key", {
        content: "To be frank, I prefer plan B.",
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ pendingGeneration: "assistant-turn" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("routes start and final feedback through durable generation and maps bounded aliases", async () => {
    const store = repository({
      beginFinish: vi.fn(async () => ({
        claimed: true as const,
        generationId: "finish-generation",
        leaseToken: "finish-lease",
        session: dialogue("active", 3),
      })),
      reserveStart: vi.fn(async () => ({
        claimed: true as const,
        generationId: "start-generation",
        leaseToken: "start-lease",
        session: pendingStart(),
      })),
    });
    const generator = {
      generate: vi.fn(async ({ kind }: { kind: string }) =>
        kind === "dialogue-start"
          ? {
              kind: "dialogue-start" as const,
              opener: "Which plan do you prefer?",
              plan: {
                endConditionZh: "达成下一步。",
                roleZh: "你是项目成员，对方是同事。",
                taskZh: "讨论两个计划。",
              },
              prompt: "完成一次受约束对话。",
            }
          : {
              itemFeedbacks: [{ feedback: "使用准确。", itemAlias: "item-1" as const }],
              kind: "dialogue-final-feedback" as const,
              summary: "整体表达清晰。",
            },
      ),
    };
    const module = createDialoguePracticeModule({
      generator,
      id: () => "generated-id",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository: store,
    });

    await module.startDialogue("user-a", "start-key", { itemIds: ["item-1"] });
    await module.finish("user-a", "session-1", "finish-key", { expectedRevision: 3 });

    expect(generator.generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ generationId: "start-generation", kind: "dialogue-start" }),
    );
    expect(generator.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        generationId: "finish-generation",
        kind: "dialogue-final-feedback",
      }),
    );
    expect(store.completeFinish).toHaveBeenCalledWith(
      expect.objectContaining({ itemFeedbacks: [{ feedback: "使用准确。", itemId: "item-1" }] }),
    );
  });
});
