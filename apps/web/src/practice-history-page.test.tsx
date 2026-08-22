import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  practiceHistoryDetailResponseSchema,
  type PracticeHistoryDetailResponse,
} from "@huayi/cloud-contracts";

import { PracticeHistoryPage } from "./practice-history-page.js";
import type { PracticeHistoryPageApi } from "./practice-history-page-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function detail(id = "session-1", erased = false): PracticeHistoryDetailResponse {
  return practiceHistoryDetailResponseSchema.parse({
    completedAt: "2026-08-13T05:05:00.000Z",
    itemLabels: erased ? [] : [{ itemId: "item-1", label: "to be frank" }],
    session: {
      attempts: [
        {
          answer: "To be frank, I disagree.",
          feedback: "表达自然。",
          id: "attempt-1",
          itemIds: ["item-1"],
          submittedAt: "2026-08-13T05:04:00.000Z",
        },
      ],
      createdAt: "2026-08-13T05:00:00.000Z",
      finalFeedback: "表达自然。",
      id,
      items: [
        {
          itemId: "item-1",
          ...(erased ? { learningItemDeletedAt: "2026-08-14T05:00:00.000Z" } : {}),
          position: 0,
          rating: "mastered",
          scheduleAfter: {
            consecutiveMastered: 1,
            dueAt: "2026-08-14T05:06:00.000Z",
            lastRating: "mastered",
            level: 0,
          },
          scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      prompt: "Write a sentence.",
      revision: 3,
      status: "completed",
      turns: [],
      type: "sentence-creation",
      updatedAt: "2026-08-13T05:06:00.000Z",
    },
  });
}

function api(overrides: Partial<PracticeHistoryPageApi> = {}): PracticeHistoryPageApi {
  const current = detail();
  return {
    deletePracticeHistory: vi.fn(async (id) => ({ deleted: true as const, id })),
    getPracticeHistory: vi.fn(async () => current),
    listPracticeHistory: vi.fn(async (input) => ({
      items:
        input.cursor === "next" ? [{ ...summary(current), id: "session-2" }] : [summary(current)],
      nextCursor: input.cursor === "next" ? null : "next",
    })),
    ...overrides,
  };
}

function summary(value: PracticeHistoryDetailResponse) {
  return {
    completedAt: value.completedAt,
    createdAt: value.session.createdAt,
    id: value.session.id,
    items: value.session.items.map(({ itemId, learningItemDeletedAt, rating }) => ({
      itemId,
      ...(learningItemDeletedAt === undefined ? {} : { learningItemDeletedAt }),
      ...(rating === undefined ? {} : { rating }),
    })),
    revision: value.session.revision,
    status: value.session.status,
    type: value.session.type,
    updatedAt: value.session.updatedAt,
  };
}

async function render(historyApi: PracticeHistoryPageApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <PracticeHistoryPage api={historyApi} idempotencyKey={() => "delete-1"} />,
    ),
  );
  await act(async () => Promise.resolve());
  return container;
}

describe("practice history page", () => {
  beforeEach(() => document.body.replaceChildren());

  it("loads, filters, opens structured sentence detail, and paginates", async () => {
    const historyApi = api();
    const container = await render(historyApi);
    expect(container.querySelector("h1")?.textContent).toBe("练习历史");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-session]")?.click(),
    );
    expect(container.textContent).toContain("To be frank, I disagree.");
    expect(container.textContent).toContain("表达自然");
    expect(container.textContent).toContain("to be frank：掌握");
    expect(container.textContent).not.toContain("item-1");
    expect(container.textContent).not.toContain("session-1");
    expect(container.querySelector(".practice-history-detail h2")).toBe(document.activeElement);
    await act(async () => container.querySelector<HTMLButtonElement>("[data-load-more]")?.click());
    expect(historyApi.listPracticeHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next" }),
    );
  });

  it("labels an erased learning item without trying to restore its content", async () => {
    const erased = detail("session-erased", true);
    const historyApi = api({
      getPracticeHistory: vi.fn(async () => erased),
      listPracticeHistory: vi.fn(async () => ({ items: [summary(erased)], nextCursor: null })),
    });
    const container = await render(historyApi);
    expect(container.textContent).toContain("含已删除学习项");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-session]")?.click(),
    );
    expect(container.textContent).toContain("学习项已删除：掌握");
  });

  it("announces loading, empty, and retryable errors", async () => {
    const historyApi = api({
      listPracticeHistory: vi
        .fn<PracticeHistoryPageApi["listPracticeHistory"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [], nextCursor: null }),
    });
    const container = await render(historyApi);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入练习历史");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-history]")?.click(),
    );
    expect(container.textContent).toContain("还没有练习记录");
  });

  it("requires a focused second confirmation and rereads the server after delete", async () => {
    const historyApi = api();
    const container = await render(historyApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-session]")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-delete-session]")?.click(),
    );
    const confirm = container.querySelector<HTMLButtonElement>("[data-confirm-delete-session]");
    expect(confirm).toBe(document.activeElement);
    expect(historyApi.deletePracticeHistory).not.toHaveBeenCalled();
    await act(async () => confirm?.click());
    expect(historyApi.deletePracticeHistory).toHaveBeenCalledWith(
      "session-1",
      { expectedRevision: 3 },
      "delete-1",
    );
    expect(historyApi.listPracticeHistory).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[aria-live='polite']")?.textContent).toContain("已删除");
  });

  it("suppresses an older detail response after the latest selection", async () => {
    let resolve!: (value: PracticeHistoryDetailResponse) => void;
    const older = new Promise<PracticeHistoryDetailResponse>((onResolve) => {
      resolve = onResolve;
    });
    const current = detail();
    const second = detail("session-2");
    const newer = {
      ...second,
      session: { ...second.session, prompt: "Write the newer sentence." },
    };
    const historyApi = api({
      getPracticeHistory: vi
        .fn<PracticeHistoryPageApi["getPracticeHistory"]>()
        .mockImplementationOnce(() => older)
        .mockResolvedValueOnce(newer),
      listPracticeHistory: vi.fn(async () => ({
        items: [summary(current), summary(newer)],
        nextCursor: null,
      })),
    });
    const container = await render(historyApi);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-open-session]");
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(container.textContent).toContain("Write the newer sentence.");
    await act(async () => resolve(current));
    expect(container.textContent).toContain("Write the newer sentence.");
  });
});
