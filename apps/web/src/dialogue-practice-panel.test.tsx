import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  learningItemDetailResponseSchema,
  practiceSessionResponseSchema,
  type DailyPracticeQueueResponse,
} from "@huayi/cloud-contracts";

import { DialoguePracticePanel } from "./dialogue-practice-panel.js";
import type { PracticePageApi } from "./practice-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = (id: string, text: string) => ({
  item: {
    content: {
      meaningZh: "用于表达观点",
      text,
      type: "expression" as const,
      usageZh: "用于对话。",
    },
    id,
    systemAttributes: [],
    tags: [],
    type: "expression" as const,
  },
  schedule: { consecutiveMastered: 0, dueAt: null, level: -1 as const },
});

const targets = [target("item-1", "to be frank"), target("item-2", "as a result")];
const queue: DailyPracticeQueueResponse = {
  currentItems: [],
  currentSession: null,
  dailyGoal: 2,
  date: "2026-08-13",
  items: targets,
  timezone: "Asia/Shanghai",
};

function dialogue(state: "active" | "completed" | "pending-assistant" | "pending-final" | "rated") {
  const completed = state === "completed" || state === "rated";
  const fullTurns = state !== "pending-assistant";
  const turns = [
    ["assistant", "Which plan do you prefer?"],
    ["user", "To be frank, I prefer plan B."],
    ["assistant", "What result would that have?"],
    ...(fullTurns
      ? [
          ["user", "As a result, delivery will be faster."],
          ["assistant", "What is the next step?"],
          ["user", "We should confirm the plan today."],
          ["assistant", "Agreed."],
        ]
      : []),
  ].map(([role, content], ordinal) => ({
    content: content as string,
    createdAt: "2026-08-13T03:00:00.000Z",
    id: `turn-${ordinal}`,
    ordinal,
    role: role as "assistant" | "user",
  }));
  if (state === "pending-assistant") turns.pop();
  const status = state.startsWith("pending")
    ? "awaiting-feedback"
    : completed
      ? "completed"
      : "active";
  return practiceSessionResponseSchema.parse({
    createdAt: "2026-08-13T03:00:00.000Z",
    dialoguePlan: {
      endConditionZh: "确认下一步。",
      roleZh: "你是项目成员，对方是同事。",
      taskZh: "讨论两个计划。",
    },
    ...(status === "completed"
      ? {
          finalFeedback: "整体表达清晰。",
          itemFeedbacks: [
            { feedback: "观点表达准确。", itemId: "item-1" },
            { feedback: "结果衔接自然。", itemId: "item-2" },
          ],
        }
      : {}),
    id: "session-1",
    items: targets.map((item, position) => ({
      itemId: item.item.id,
      position,
      ...(state === "rated"
        ? {
            rating: "mastered" as const,
            scheduleAfter: {
              consecutiveMastered: 1,
              dueAt: "2026-08-14T03:00:00.000Z",
              lastRating: "mastered" as const,
              level: 0,
            },
          }
        : {}),
      scheduleBefore: item.schedule,
    })),
    ...(state === "pending-assistant"
      ? { pendingGeneration: "assistant-turn" }
      : state === "pending-final"
        ? { pendingGeneration: "final-feedback" }
        : {}),
    prompt: "完成一次受约束对话。",
    revision: state === "active" ? 3 : state === "pending-assistant" ? 2 : 5,
    status,
    turns,
    type: "dialogue",
    updatedAt: "2026-08-13T03:05:00.000Z",
  });
}

function detail(id: string) {
  const item = targets.find((candidate) => candidate.item.id === id);
  if (item === undefined) throw new Error("Missing target.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: {
      ...item.item,
      canonicalKey: item.item.content.text,
      createdAt: "2026-08-13T03:00:00.000Z",
      revision: 1,
      sourceExamples: [
        {
          id: `source-${id}`,
          sourceText: `Source for ${item.item.content.text}.`,
          sourceType: "manual",
        },
      ],
      updatedAt: "2026-08-13T03:00:00.000Z",
    },
    recentPractice: null,
    schedule: item.schedule,
  });
}

function api(overrides: Partial<PracticePageApi> = {}): PracticePageApi {
  return {
    dailyQueue: vi.fn(async () => queue),
    finish: vi.fn(async () => dialogue("completed")),
    getLearningItem: vi.fn(async (id) => detail(id)),
    rate: vi.fn(async () => dialogue("rated")),
    retryAssistant: vi.fn(async () => dialogue("active")),
    retryFeedback: vi.fn(),
    startDialogue: vi.fn(async () => dialogue("active")),
    startSentence: vi.fn(),
    submitAttempt: vi.fn(),
    submitTurn: vi.fn(async () => dialogue("pending-assistant")),
    ...overrides,
  };
}

async function render(
  practiceApi: PracticePageApi,
  session: ReturnType<typeof dialogue> | null,
  onRecover: () => Promise<ReturnType<typeof dialogue> | null> = async () => null,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const onSession = vi.fn();
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <DialoguePracticePanel
        api={practiceApi}
        idempotencyKey={() => "key-1"}
        onRecover={onRecover}
        onSession={onSession}
        queue={{ ...queue, currentItems: session === null ? [] : targets, currentSession: session }}
        session={session}
      />,
    ),
  );
  await act(async () => Promise.resolve());
  return { container, onSession, root };
}

function change(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("constrained dialogue panel", () => {
  it("starts with one to three keyboard-operable selected queue items", async () => {
    const practiceApi = api();
    const { container, onSession } = await render(practiceApi, null);
    const checks = [...container.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
    await act(async () => checks[0]?.click());
    await act(async () => checks[1]?.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-start-dialogue]")?.click(),
    );
    expect(practiceApi.startDialogue).toHaveBeenCalledWith(["item-1", "item-2"], "key-1");
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ type: "dialogue" }));
  });

  it("submits a user turn, preserves server pending state, and explicitly retries", async () => {
    const pending = dialogue("pending-assistant");
    const practiceApi = api({ submitTurn: vi.fn(async () => pending) });
    const { container, onSession } = await render(practiceApi, dialogue("active"));
    const textarea = container.querySelector<HTMLTextAreaElement>("[name='dialogue-turn']");
    if (textarea === null) throw new Error("Dialogue textarea missing.");
    await act(async () => change(textarea, "To be frank, I prefer plan B."));
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-dialogue-turn-form]")?.requestSubmit(),
    );
    expect(practiceApi.submitTurn).toHaveBeenCalledWith(
      "session-1",
      { content: "To be frank, I prefer plan B.", expectedRevision: 3 },
      "key-1",
    );
    expect(onSession).toHaveBeenCalledWith(pending);

    const pendingRender = await render(practiceApi, pending);
    expect(pendingRender.container.textContent).toContain("不会自动发起第二次");
    await act(async () =>
      pendingRender.container.querySelector<HTMLButtonElement>("[data-retry-dialogue]")?.click(),
    );
    expect(practiceApi.retryAssistant).toHaveBeenCalledWith(
      "session-1",
      { expectedRevision: 2 },
      "key-1",
    );
  });

  it("re-reads a lost turn response and clears only a server-persisted draft", async () => {
    const pending = dialogue("pending-assistant");
    const practiceApi = api({ submitTurn: vi.fn(async () => Promise.reject(new Error("lost"))) });
    const recovered = vi.fn(async () => pending);
    const rendered = await render(practiceApi, dialogue("active"), recovered);
    const textarea =
      rendered.container.querySelector<HTMLTextAreaElement>("[name='dialogue-turn']");
    if (textarea === null) throw new Error("Dialogue textarea missing.");
    await act(async () => change(textarea, "To be frank, I prefer plan B."));
    await act(async () =>
      rendered.container
        .querySelector<HTMLFormElement>("[data-dialogue-turn-form]")
        ?.requestSubmit(),
    );
    expect(recovered).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("");

    const notSaved = vi.fn(async () => dialogue("active"));
    const second = await render(practiceApi, dialogue("active"), notSaved);
    const secondTextarea =
      second.container.querySelector<HTMLTextAreaElement>("[name='dialogue-turn']");
    if (secondTextarea === null) throw new Error("Dialogue textarea missing.");
    await act(async () => change(secondTextarea, "Keep this draft."));
    await act(async () =>
      second.container.querySelector<HTMLFormElement>("[data-dialogue-turn-form]")?.requestSubmit(),
    );
    expect(secondTextarea.value).toBe("Keep this draft.");
  });

  it("reveals per-item feedback and sources only after completion, then rates all items", async () => {
    const practiceApi = api();
    const active = await render(practiceApi, dialogue("active"));
    expect(active.container.textContent).not.toContain("Source for");
    expect(active.container.querySelector("[data-finish-dialogue]")).not.toBeNull();

    const completed = await render(practiceApi, dialogue("completed"));
    expect(completed.container.textContent).toContain("观点表达准确");
    expect(completed.container.textContent).toContain("Source for to be frank");
    const selects = [...completed.container.querySelectorAll<HTMLSelectElement>("select")];
    await act(async () => {
      for (const select of selects) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
          select,
          "mastered",
        );
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () =>
      completed.container
        .querySelector<HTMLFormElement>("[data-dialogue-ratings]")
        ?.requestSubmit(),
    );
    expect(practiceApi.rate).toHaveBeenCalledWith(
      "session-1",
      {
        expectedRevision: 5,
        ratings: [
          { itemId: "item-1", rating: "mastered" },
          { itemId: "item-2", rating: "mastered" },
        ],
      },
      "key-1",
    );
  });

  it("suppresses a late generation result after the panel unmounts", async () => {
    let resolveStart: ((value: ReturnType<typeof dialogue>) => void) | undefined;
    const startDialogue = vi.fn(
      async () =>
        new Promise<ReturnType<typeof dialogue>>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const rendered = await render(api({ startDialogue }), null);
    await act(async () =>
      rendered.container.querySelector<HTMLInputElement>("input[type='checkbox']")?.click(),
    );
    await act(async () =>
      rendered.container.querySelector<HTMLButtonElement>("[data-start-dialogue]")?.click(),
    );
    await act(async () => rendered.root.unmount());
    await act(async () => resolveStart?.(dialogue("active")));
    expect(rendered.onSession).not.toHaveBeenCalled();
  });
});
