import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WordEntryDetailResponse } from "@huayi/cloud-contracts";

import { WordLibraryPage } from "./word-library-page.js";
import type { WebWordLibraryApi } from "./word-library-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const word = {
  canonicalKey: "run into",
  createdAt: "2026-08-13T01:00:00.000Z",
  headword: "run into",
  id: "word-1",
  notes: "偶然遇见",
  revision: 1,
  updatedAt: "2026-08-13T01:00:00.000Z",
};
const detail: WordEntryDetailResponse = {
  contexts: {
    items: [
      {
        contextualMeaningZh: "偶然遇见",
        id: "context-1",
        observedAt: "2026-08-13T02:00:00.000Z",
        sourceText: "I ran into her.",
        sourceType: "manual",
      },
    ],
    nextCursor: null,
  },
  word,
};

function api(overrides: Partial<WebWordLibraryApi> = {}): WebWordLibraryApi {
  return {
    deleteWord: vi.fn(async (id) => ({ deleted: true as const, id })),
    getWord: vi.fn(async () => detail),
    listWords: vi.fn(async () => ({ items: [word], nextCursor: "next" })),
    patchWord: vi.fn(async () => ({ ...word, notes: "更新", revision: 2 })),
    upsertWord: vi.fn(async () => ({
      contextOutcome: "created" as const,
      word,
      wordOutcome: "created" as const,
    })),
    ...overrides,
  };
}

async function render(words: WebWordLibraryApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(<WordLibraryPage api={words} />));
  await act(async () => Promise.resolve());
  return container;
}

async function input(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Web word library", () => {
  beforeEach(() => document.body.replaceChildren());

  it("rereads the saved word and filtered list after a manual upsert", async () => {
    const words = api();
    const container = await render(words);
    const headword = container.querySelector<HTMLInputElement>("[name='headword']");
    if (headword === null) throw new Error("Manual headword input missing.");
    await input(headword, "run into");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".manual-word-card form")?.requestSubmit(),
    );
    expect(words.upsertWord).toHaveBeenCalledOnce();
    expect(words.getWord).toHaveBeenCalledWith("word-1", { contextLimit: 20 });
    expect(words.listWords).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".word-detail h2")?.textContent).toBe("run into");
  });

  it("loads, searches, paginates and focuses owner detail contexts", async () => {
    const words = api({
      getWord: vi.fn(async (_id, input) =>
        input.contextCursor === undefined
          ? { ...detail, contexts: { ...detail.contexts, nextCursor: "context-next" } }
          : {
              ...detail,
              contexts: {
                items: [
                  {
                    id: "context-2",
                    observedAt: "2026-08-12T02:00:00.000Z",
                    sourceText: "A second context.",
                    sourceType: "manual" as const,
                  },
                ],
                nextCursor: null,
              },
            },
      ),
    });
    const container = await render(words);
    expect(container.querySelector("h1")?.textContent).toBe("生词");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open-word]")?.click());
    expect(container.textContent).toContain("I ran into her.");
    expect(container.querySelector(".word-detail h2")).toBe(document.activeElement);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-more-contexts]")?.click(),
    );
    expect(container.textContent).toContain("A second context.");
    expect(words.getWord).toHaveBeenLastCalledWith(
      "word-1",
      expect.objectContaining({ contextCursor: "context-next" }),
    );
    const query = container.querySelector<HTMLInputElement>("[name='query']");
    if (query === null) throw new Error("Search input missing.");
    await input(query, "run");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(words.listWords).toHaveBeenLastCalledWith(expect.objectContaining({ query: "run" }));
    await act(async () => container.querySelector<HTMLButtonElement>("[data-more-words]")?.click());
    expect(words.listWords).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next" }));
  });

  it("retains notes on conflict and requires two delete confirmations", async () => {
    const words = api({
      patchWord: vi.fn(async () => {
        throw new Error("conflict");
      }),
    });
    const container = await render(words);
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open-word]")?.click());
    const notes = container.querySelector<HTMLTextAreaElement>("[name='notes']");
    if (notes === null) throw new Error("Notes input missing.");
    await input(notes, "我的草稿");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-save-notes]")?.click());
    expect(notes.value).toBe("我的草稿");
    expect(container.querySelector("[role='alert']")?.textContent).toContain("保留了备注草稿");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-delete-word]")?.click(),
    );
    expect(words.deleteWord).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>("[data-confirm-delete]")).toBe(
      document.activeElement,
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-delete]")?.click(),
    );
    expect(words.deleteWord).toHaveBeenCalledOnce();
    expect(words.listWords).toHaveBeenCalledTimes(2);
  });

  it("reports a saved note honestly when the following server reread fails", async () => {
    const words = api({
      listWords: vi
        .fn<WebWordLibraryApi["listWords"]>()
        .mockResolvedValueOnce({ items: [word], nextCursor: null })
        .mockRejectedValueOnce(new Error("refresh failed")),
    });
    const container = await render(words);
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open-word]")?.click());
    const notes = container.querySelector<HTMLTextAreaElement>("[name='notes']");
    if (notes === null) throw new Error("Notes input missing.");
    await input(notes, "服务器已保存的备注");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-save-notes]")?.click());

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "备注已经保存，但暂时无法刷新生词列表",
    );
    expect(notes.value).toBe("服务器已保存的备注");
  });

  it("reports a completed delete honestly when the following server reread fails", async () => {
    const words = api({
      listWords: vi
        .fn<WebWordLibraryApi["listWords"]>()
        .mockResolvedValueOnce({ items: [word], nextCursor: null })
        .mockRejectedValueOnce(new Error("refresh failed")),
    });
    const container = await render(words);
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open-word]")?.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-delete-word]")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-delete]")?.click(),
    );

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "词条已经删除，但暂时无法刷新生词列表",
    );
    expect(container.querySelector("[data-confirm-delete]")).toBeNull();
  });

  it("shows retryable loading, error and empty states", async () => {
    const words = api({
      listWords: vi
        .fn<WebWordLibraryApi["listWords"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [], nextCursor: null }),
    });
    const container = await render(words);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入生词");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-words]")?.click(),
    );
    expect(container.textContent).toContain("当前搜索下没有生词");
  });

  it("suppresses a stale detail response after a newer selection", async () => {
    let resolve!: (value: WordEntryDetailResponse) => void;
    const older = new Promise<WordEntryDetailResponse>((done) => {
      resolve = done;
    });
    const second = {
      ...detail,
      word: { ...word, canonicalKey: "make do", headword: "make do", id: "word-2" },
    };
    const words = api({
      getWord: vi
        .fn<WebWordLibraryApi["getWord"]>()
        .mockImplementationOnce(() => older)
        .mockResolvedValueOnce(second),
      listWords: vi.fn(async () => ({ items: [word, second.word], nextCursor: null })),
    });
    const container = await render(words);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-open-word]");
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(container.querySelector(".word-detail h2")?.textContent).toBe("make do");
    await act(async () => resolve(detail));
    expect(container.querySelector(".word-detail h2")?.textContent).toBe("make do");
  });
});
