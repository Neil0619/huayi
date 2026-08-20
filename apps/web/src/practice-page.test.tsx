import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  contractFixtures,
  learningItemDetailResponseSchema,
  practiceSessionResponseSchema,
} from "@huayi/cloud-contracts";

import { PracticePage, type PracticePageApi } from "./practice-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = {
  item: {
    content: {
      meaningZh: "坦率地说",
      text: "to be frank",
      type: "expression" as const,
      usageZh: "表达意见。",
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
    ...(status === "active"
      ? {}
      : {
          attempts: [
            {
              answer: "To be frank, I disagree.",
              ...(status === "completed" ? { feedback: "准确、自然；建议保持简洁。" } : {}),
              id: "attempt-1",
              itemIds: ["item-1"],
              submittedAt: "2026-08-13T03:01:00.000Z",
            },
          ],
        }),
    createdAt: "2026-08-13T03:00:00.000Z",
    ...(status === "completed" ? { finalFeedback: "准确、自然；建议保持简洁。" } : {}),
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: target.schedule }],
    prompt: "请写一句坦率但礼貌的意见。",
    revision,
    status,
    turns: [],
    type: "sentence-creation",
    updatedAt: "2026-08-13T03:01:00.000Z",
  });
}

function pendingPrompt() {
  return practiceSessionResponseSchema.parse({
    createdAt: "2026-08-13T03:00:00.000Z",
    id: "session-1",
    items: [{ itemId: "item-1", position: 0, scheduleBefore: target.schedule }],
    pendingGeneration: "sentence-prompt",
    revision: 1,
    status: "awaiting-feedback",
    turns: [],
    type: "sentence-creation",
    updatedAt: "2026-08-13T03:00:00.000Z",
  });
}

function detail() {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: { ...result.item, id: "item-1" },
    recentPractice: null,
    schedule: target.schedule,
  });
}

function api(overrides: Partial<PracticePageApi> = {}): PracticePageApi {
  return {
    dailyQueue: vi.fn(async () => ({
      currentItems: [],
      currentSession: null,
      dailyGoal: 1,
      date: "2026-08-13",
      items: [target],
      timezone: "Asia/Shanghai",
    })),
    finish: vi.fn(async () => session("completed", 3)),
    getLearningItem: vi.fn(async () => detail()),
    rate: vi.fn(async () =>
      practiceSessionResponseSchema.parse({
        ...session("completed", 4),
        items: [
          {
            itemId: "item-1",
            position: 0,
            rating: "mastered",
            scheduleAfter: {
              consecutiveMastered: 1,
              dueAt: "2026-08-16T03:00:00.000Z",
              lastRating: "mastered",
              level: 0,
            },
            scheduleBefore: target.schedule,
          },
        ],
      }),
    ),
    retryAssistant: vi.fn(async () => session("active", 3)),
    retryFeedback: vi.fn(async () => session("completed", 3)),
    startDialogue: vi.fn(async () => session("active", 1)),
    startSentence: vi.fn(async () => session("active", 1)),
    submitAttempt: vi.fn(async () => session("completed", 3)),
    submitTurn: vi.fn(async () => session("active", 3)),
    ...overrides,
  };
}

function change(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function render(practiceApi: PracticePageApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(<PracticePage api={practiceApi} idempotencyKey={() => "key-1"} />),
  );
  await act(async () => Promise.resolve());
  return container;
}

describe("Web sentence practice", () => {
  beforeEach(() => document.body.replaceChildren());

  it("covers loading, retryable error, and empty queue", async () => {
    const practiceApi = api({
      dailyQueue: vi
        .fn<PracticePageApi["dailyQueue"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({
          currentItems: [],
          currentSession: null,
          dailyGoal: 1,
          date: "2026-08-13",
          items: [],
          timezone: "UTC",
        }),
    });
    const container = await render(practiceApi);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入今日练习");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-practice]")?.click(),
    );
    expect(container.textContent).toContain("今天没有待练习内容");
  });

  it("submits an answer, reveals feedback and sources, then rates once", async () => {
    const practiceApi = api();
    const container = await render(practiceApi);
    expect(container.textContent).not.toContain("To be frank, I disagree");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-start-practice]")?.click(),
    );
    const answer = container.querySelector<HTMLTextAreaElement>("[name='answer']");
    if (answer === null) throw new Error("Answer missing.");
    await act(async () => change(answer, "To be frank, I disagree."));
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-attempt-form]")?.requestSubmit(),
    );
    expect(practiceApi.submitAttempt).toHaveBeenCalledWith(
      "session-1",
      { answer: "To be frank, I disagree.", expectedRevision: 1 },
      "key-1",
    );
    expect(practiceApi.getLearningItem).toHaveBeenCalledWith("item-1");
    expect(container.textContent).toContain("准确、自然");
    expect(container.textContent).toContain("To be frank, this works.");
    expect(container.querySelector("[data-feedback-heading]")).toBe(document.activeElement);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-rating='mastered']")?.click(),
    );
    expect(practiceApi.rate).toHaveBeenCalledWith(
      "session-1",
      { expectedRevision: 3, ratings: [{ itemId: "item-1", rating: "mastered" }] },
      "key-1",
    );
    expect(container.querySelector("[aria-live='polite']")?.textContent).toContain("排期已更新");
  });

  it("preserves the answer and offers explicit retry while feedback is pending", async () => {
    const practiceApi = api({ submitAttempt: vi.fn(async () => session("awaiting-feedback", 2)) });
    const container = await render(practiceApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-start-practice]")?.click(),
    );
    const answer = container.querySelector<HTMLTextAreaElement>("[name='answer']");
    if (answer === null) throw new Error("Answer missing.");
    await act(async () => change(answer, "To be frank, I disagree."));
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-attempt-form]")?.requestSubmit(),
    );
    expect(container.textContent).toContain("反馈尚未完成");
    expect(container.textContent).toContain("To be frank, I disagree.");
    expect(answer.value).toBe("To be frank, I disagree.");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-feedback]")?.click(),
    );
    expect(practiceApi.retryFeedback).toHaveBeenCalledWith(
      "session-1",
      "attempt-1",
      { expectedRevision: 2 },
      "key-1",
    );
  });

  it("restores a pending prompt without fake task text and retries only on explicit action", async () => {
    const practiceApi = api({
      dailyQueue: vi.fn(async () => ({
        currentItems: [target],
        currentSession: pendingPrompt(),
        dailyGoal: 1,
        date: "2026-08-13",
        items: [target],
        timezone: "Asia/Shanghai",
      })),
      startSentence: vi.fn(async () => session("active", 2)),
    });
    const container = await render(practiceApi);

    expect(container.textContent).toContain("题目尚未完成");
    expect(container.textContent).toContain("不会自动再次调用模型");
    expect(container.textContent).not.toContain("Generation pending");
    expect(practiceApi.startSentence).not.toHaveBeenCalled();

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-prompt]")?.click(),
    );
    expect(practiceApi.startSentence).toHaveBeenCalledWith("item-1", "key-1");
    expect(container.textContent).toContain("请写一句坦率但礼貌的意见");
  });

  it("restores an awaiting-feedback server session without cancelling it on page close", async () => {
    const pending = session("awaiting-feedback", 2);
    const practiceApi = api({
      dailyQueue: vi.fn(async () => ({
        currentItems: [target],
        currentSession: pending,
        dailyGoal: 1,
        date: "2026-08-13",
        items: [target],
        timezone: "Asia/Shanghai",
      })),
    });
    const container = await render(practiceApi);
    expect(container.textContent).toContain("反馈尚未完成");
    expect(container.textContent).not.toContain("开始句子创作");
    expect(container.querySelector<HTMLTextAreaElement>("[name='answer']")).toBeNull();
  });

  it("restores completed unrated feedback and sources after refresh", async () => {
    const completed = session("completed", 3);
    const practiceApi = api({
      dailyQueue: vi.fn(async () => ({
        currentItems: [target],
        currentSession: completed,
        dailyGoal: 1,
        date: "2026-08-13",
        items: [],
        timezone: "Asia/Shanghai",
      })),
    });
    const container = await render(practiceApi);
    expect(container.textContent).toContain("准确、自然");
    expect(container.textContent).toContain("To be frank, this works.");
    expect(container.querySelector("[data-rating='mastered']")).not.toBeNull();
  });

  it("re-reads server authority when attempt submission loses its response", async () => {
    const pending = session("awaiting-feedback", 2);
    const practiceApi = api({
      dailyQueue: vi
        .fn<PracticePageApi["dailyQueue"]>()
        .mockResolvedValueOnce({
          currentItems: [],
          currentSession: null,
          dailyGoal: 1,
          date: "2026-08-13",
          items: [target],
          timezone: "Asia/Shanghai",
        })
        .mockResolvedValueOnce({
          currentItems: [target],
          currentSession: pending,
          dailyGoal: 1,
          date: "2026-08-13",
          items: [target],
          timezone: "Asia/Shanghai",
        }),
      submitAttempt: vi.fn(async () => Promise.reject(new Error("lost response"))),
    });
    const container = await render(practiceApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-start-practice]")?.click(),
    );
    const answer = container.querySelector<HTMLTextAreaElement>("[name='answer']");
    if (answer === null) throw new Error("Answer missing.");
    await act(async () => change(answer, "To be frank, I disagree."));
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-attempt-form]")?.requestSubmit(),
    );
    expect(practiceApi.dailyQueue).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("反馈尚未完成");
    expect(container.textContent).toContain("To be frank, I disagree.");
  });

  it("retains the draft when the server proves the attempt was not saved", async () => {
    const active = session("active", 1);
    const practiceApi = api({
      dailyQueue: vi
        .fn<PracticePageApi["dailyQueue"]>()
        .mockResolvedValueOnce({
          currentItems: [],
          currentSession: null,
          dailyGoal: 1,
          date: "2026-08-13",
          items: [target],
          timezone: "Asia/Shanghai",
        })
        .mockResolvedValueOnce({
          currentItems: [target],
          currentSession: active,
          dailyGoal: 1,
          date: "2026-08-13",
          items: [target],
          timezone: "Asia/Shanghai",
        }),
      submitAttempt: vi.fn(async () => Promise.reject(new Error("not saved"))),
    });
    const container = await render(practiceApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-start-practice]")?.click(),
    );
    const answer = container.querySelector<HTMLTextAreaElement>("[name='answer']");
    if (answer === null) throw new Error("Answer missing.");
    await act(async () => change(answer, "To be frank, keep this draft."));
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-attempt-form]")?.requestSubmit(),
    );
    expect(container.querySelector<HTMLTextAreaElement>("[name='answer']")?.value).toBe(
      "To be frank, keep this draft.",
    );
  });
});
