import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  contractFixtures,
  learningItemDetailResponseSchema,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

import { LearningLibraryPage, type LearningLibraryApi } from "./learning-library-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function detail(): LearningItemDetailResponse {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: result.item,
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

function api(overrides: Partial<LearningLibraryApi> = {}): LearningLibraryApi {
  const current = detail();
  const second = { ...current, item: { ...current.item, id: "item-2" } };
  return {
    archiveLearningItem: vi.fn(async () => ({
      ...current,
      archivedAt: "2026-08-14T03:00:00.000Z",
      item: { ...current.item, revision: current.item.revision + 1 },
    })),
    confirmLearningItemMerge: vi.fn(async () => ({
      deletedSourceId: "item-1",
      target: second,
    })),
    createLearningItem: vi.fn(async () => detail()),
    deleteLearningItem: vi.fn(async (id) => ({
      deleted: true as const,
      deletionKind: "hard-delete" as const,
      id,
    })),
    getLearningItem: vi.fn(async () => detail()),
    listLearningItems: vi.fn(async (input) =>
      input.cursor === "next"
        ? { items: [second], nextCursor: null }
        : { items: [detail()], nextCursor: "next" },
    ),
    patchLearningItem: vi.fn(async () => ({
      ...current,
      item: { ...current.item, revision: current.item.revision + 1 },
    })),
    previewLearningItemMerge: vi.fn(async () => ({
      allowed: true,
      blockedReason: null,
      scheduleDecision: "keep-target" as const,
      source: current,
      target: second,
    })),
    restoreLearningItem: vi.fn(async () => ({
      ...current,
      item: { ...current.item, revision: current.item.revision + 1 },
    })),
    suggestLearningItemDuplicates: vi.fn(async () => ({
      itemRevision: current.item.revision,
      suggestions: [],
    })),
    ...overrides,
  };
}

async function render(libraryApi: LearningLibraryApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(<LearningLibraryPage api={libraryApi} />));
  await act(async () => Promise.resolve());
  return container;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("Web learning library", () => {
  beforeEach(() => document.body.replaceChildren());

  it("loads owner views, opens detail, and appends a server page", async () => {
    const libraryApi = api();
    const container = await render(libraryApi);
    expect(container.querySelector("h1")?.textContent).toBe("学习库");
    expect(container.textContent).toContain("to be frank");
    expect(container.textContent).toContain("新学习项");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open-item]")?.click());
    expect(libraryApi.getLearningItem).toHaveBeenCalledWith("item-1");
    expect(container.textContent).toContain("用于直接表达个人意见");
    expect(container.textContent).toContain("来源示例");
    expect(container.textContent).toContain("Writing notes");
    expect(container.textContent).toContain("To be frank, this works.");
    expect(container.querySelector(".library-detail h2")).toBe(document.activeElement);
    await act(async () => container.querySelector<HTMLButtonElement>("[data-load-more]")?.click());
    expect(libraryApi.listLearningItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next" }),
    );
    const type = container.querySelector<HTMLSelectElement>("[name='type']");
    if (type === null) throw new Error("Type filter missing.");
    await act(async () => {
      type.value = "sentence-pattern";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(libraryApi.listLearningItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "sentence-pattern" }),
    );
    const archived = container.querySelector<HTMLSelectElement>("[name='archived']");
    if (archived === null) throw new Error("Archived filter missing.");
    await act(async () => {
      archived.value = "true";
      archived.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(libraryApi.listLearningItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true }),
    );
  });

  it("archives and restores with server rereads and mode-specific actions", async () => {
    const current = detail();
    const archived = {
      ...current,
      archivedAt: "2026-08-14T03:00:00.000Z",
      item: { ...current.item, revision: 2 },
    };
    const libraryApi = api({
      archiveLearningItem: vi.fn(async () => archived),
      getLearningItem: vi
        .fn<LearningLibraryApi["getLearningItem"]>()
        .mockResolvedValueOnce(current)
        .mockResolvedValue(archived),
      listLearningItems: vi.fn(async () => ({ items: [current], nextCursor: null })),
      restoreLearningItem: vi.fn(async () => ({
        ...archived,
        archivedAt: null,
        item: { ...archived.item, revision: 3 },
      })),
    });
    const container = await render(libraryApi);
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open-item]")?.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-request-archive-learning-item]")?.click(),
    );
    expect(libraryApi.archiveLearningItem).not.toHaveBeenCalled();
    expect(container.textContent).toContain("保留内容、排期和全部练习历史");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-archive-learning-item]")?.click(),
    );
    expect(libraryApi.archiveLearningItem).toHaveBeenCalledWith(
      current.item.id,
      { expectedRevision: current.item.revision },
      expect.any(String),
    );
    expect(libraryApi.listLearningItems).toHaveBeenCalledTimes(2);
    expect(libraryApi.getLearningItem).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-restore-learning-item]")).not.toBeNull();
    expect(container.querySelector("[data-request-archive-learning-item]")).toBeNull();

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-restore-learning-item]")?.click(),
    );
    expect(libraryApi.restoreLearningItem).toHaveBeenCalledWith(
      current.item.id,
      { expectedRevision: 2 },
      expect.any(String),
    );
  });

  it("announces empty and retryable error states", async () => {
    const libraryApi = api({
      listLearningItems: vi
        .fn<LearningLibraryApi["listLearningItems"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [], nextCursor: null }),
    });
    const container = await render(libraryApi);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入学习库");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-library]")?.click(),
    );
    expect(container.textContent).toContain("当前筛选下没有学习项");
  });

  it("announces loading until the server page resolves", async () => {
    const pending = deferred<Awaited<ReturnType<LearningLibraryApi["listLearningItems"]>>>();
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <LearningLibraryPage api={api({ listLearningItems: vi.fn(() => pending.promise) })} />,
      ),
    );
    expect(container.querySelector("[role='status']")?.textContent).toContain("正在载入学习库");
    await act(async () => pending.resolve({ items: [], nextCursor: null }));
    expect(container.textContent).toContain("当前筛选下没有学习项");
  });

  it("does not let an older list response replace newer filtered results", async () => {
    const first = deferred<Awaited<ReturnType<LearningLibraryApi["listLearningItems"]>>>();
    const current = detail();
    const newer = {
      ...current,
      item: {
        ...current.item,
        id: "item-2",
        content: { ...current.item.content, meaningZh: "新的筛选结果" },
      },
    };
    const listLearningItems = vi
      .fn<LearningLibraryApi["listLearningItems"]>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ items: [newer], nextCursor: null });
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(<LearningLibraryPage api={api({ listLearningItems })} />),
    );
    const type = container.querySelector<HTMLSelectElement>("[name='type']");
    if (type === null) throw new Error("Type filter missing.");
    await act(async () => {
      type.value = "expression";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("新的筛选结果");

    await act(async () => first.resolve({ items: [current], nextCursor: null }));
    expect(container.textContent).toContain("新的筛选结果");
  });

  it("does not let an older detail response replace the latest selection", async () => {
    const current = detail();
    const second = {
      ...current,
      item: {
        ...current.item,
        id: "item-2",
        content: { ...current.item.content, meaningZh: "第二条详情" },
      },
    };
    const firstDetail = deferred<LearningItemDetailResponse>();
    const secondDetail = deferred<LearningItemDetailResponse>();
    const libraryApi = api({
      getLearningItem: vi
        .fn<LearningLibraryApi["getLearningItem"]>()
        .mockImplementationOnce(() => firstDetail.promise)
        .mockImplementationOnce(() => secondDetail.promise),
      listLearningItems: vi.fn(async () => ({ items: [current, second], nextCursor: null })),
    });
    const container = await render(libraryApi);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-open-item]");
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    await act(async () => secondDetail.resolve(second));
    expect(container.querySelector(".library-detail")?.textContent).toContain("第二条详情");

    await act(async () => firstDetail.resolve(current));
    expect(container.querySelector(".library-detail")?.textContent).toContain("第二条详情");
  });

  it("rereads list and detail after a manual create", async () => {
    const libraryApi = api();
    const container = await render(libraryApi);
    for (const [name, value] of Object.entries({
      meaningZh: "因此",
      text: "as a result",
      usageZh: "用于说明结果。",
    })) {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name='${name}']`,
      );
      if (input === null) throw new Error(`Missing ${name}.`);
      await act(async () => {
        const prototype =
          input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await act(async () =>
      container.querySelector<HTMLFormElement>(".manual-learning-item form")?.requestSubmit(),
    );
    expect(libraryApi.listLearningItems).toHaveBeenCalledTimes(2);
    expect(libraryApi.getLearningItem).toHaveBeenCalledWith("item-1");
    expect(container.querySelector("[aria-live='polite']")?.textContent).toContain("已收录");
    expect(container.querySelector(".library-detail h2")).toBe(document.activeElement);
  });

  it("shows the server-read created detail when active filters exclude it", async () => {
    const created = detail();
    const libraryApi = api({
      createLearningItem: vi.fn(async () => created),
      getLearningItem: vi.fn(async () => created),
      listLearningItems: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    const container = await render(libraryApi);
    for (const [name, value] of Object.entries({
      meaningZh: "坦率地说",
      text: "to be frank",
      usageZh: "用于直接表达意见。",
    })) {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `.manual-learning-item [name='${name}']`,
      );
      if (input === null) throw new Error(`Missing ${name}.`);
      await act(async () => {
        const prototype =
          input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await act(async () =>
      container.querySelector<HTMLFormElement>(".manual-learning-item form")?.requestSubmit(),
    );

    expect(container.textContent).toContain("当前筛选下没有学习项");
    expect(container.querySelector(".library-detail")?.textContent).toContain("to be frank");
    expect(container.textContent).toContain("已收录并从学习库重新载入");
  });
});
