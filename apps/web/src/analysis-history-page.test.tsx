import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  analysisRecordSchema,
  contractFixtures,
  type AnalysisRecord,
} from "@huayi/cloud-contracts";

import { AnalysisHistoryPage } from "./analysis-history-page.js";
import type { AnalysisHistoryPageApi } from "./analysis-history-page-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analysis = analysisRecordSchema.parse(contractFixtures.analysis);

function api(overrides: Partial<AnalysisHistoryPageApi> = {}): AnalysisHistoryPageApi {
  return {
    archiveAnalysis: vi.fn(async () => ({
      ...analysis,
      archivedAt: "2026-08-13T05:00:00.000Z",
      revision: 2,
    })),
    deleteAnalysis: vi.fn(async (id) => ({ deleted: true as const, id })),
    getAnalysis: vi.fn(async () => analysis),
    listHistory: vi.fn(async (query) => ({
      items: [{ ...analysis, id: query.cursor === undefined ? "analysis-1" : "analysis-2" }],
      nextCursor: query.cursor === undefined ? "next" : null,
    })),
    processNothingToSave: vi.fn(async () => ({
      ...analysis,
      reviewState: "reviewed" as const,
      revision: 2,
    })),
    restoreAnalysis: vi.fn(async () => ({ ...analysis, archivedAt: null, revision: 3 })),
    ...overrides,
  };
}

async function render(historyApi: AnalysisHistoryPageApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <AnalysisHistoryPage api={historyApi} idempotencyKey={() => "key-1"} />,
    ),
  );
  await act(async () => Promise.resolve());
  return container;
}

async function select(control: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Web analysis history", () => {
  beforeEach(() => document.body.replaceChildren());

  it("filters, paginates and renders strict structured detail", async () => {
    const historyApi = api();
    const container = await render(historyApi);
    expect(container.querySelector("h1")?.textContent).toBe("分析历史");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-analysis]")?.click(),
    );
    expect(container.querySelector(".analysis-history-detail h2")).toBe(document.activeElement);
    expect(container.textContent).toContain("坦率地说，这很有效");
    expect(container.textContent).toContain("to be frank");
    expect(container.textContent).toContain("deepseek-chat");
    const archived = container.querySelector<HTMLSelectElement>("[name='archived']");
    const review = container.querySelector<HTMLSelectElement>("[name='reviewState']");
    if (archived === null || review === null) throw new Error("History filters missing.");
    await select(archived, "true");
    await select(review, "reviewed");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(historyApi.listHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true, reviewState: "reviewed" }),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-more-history]")?.click(),
    );
    expect(historyApi.listHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next" }),
    );
  });

  it("keeps archive separate from review state and rereads after actions", async () => {
    const historyApi = api();
    const container = await render(historyApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-analysis]")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-process-analysis]")?.click(),
    );
    expect(historyApi.processNothingToSave).toHaveBeenCalledWith("analysis-1", 1, "key-1");
    expect(historyApi.getAnalysis).toHaveBeenCalledTimes(2);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-archive-analysis]")?.click(),
    );
    expect(historyApi.archiveAnalysis).toHaveBeenCalled();
    expect(container.textContent).toContain("整理状态与归档状态彼此独立");
  });

  it("prevents duplicate mutations while an action is pending", async () => {
    let resolveArchive!: (value: AnalysisRecord) => void;
    const archive = new Promise<AnalysisRecord>((done) => {
      resolveArchive = done;
    });
    const historyApi = api({ archiveAnalysis: vi.fn(() => archive) });
    const container = await render(historyApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-analysis]")?.click(),
    );
    const archiveButton = container.querySelector<HTMLButtonElement>("[data-archive-analysis]");
    await act(async () => {
      archiveButton?.click();
      await Promise.resolve();
    });
    expect(archiveButton?.disabled).toBe(true);
    archiveButton?.click();
    expect(historyApi.archiveAnalysis).toHaveBeenCalledOnce();
    await act(async () =>
      resolveArchive({ ...analysis, archivedAt: analysis.createdAt, revision: 2 }),
    );
  });

  it("reports completed mutation when refresh fails and retains detail on action failure", async () => {
    const historyApi = api({
      getAnalysis: vi
        .fn<AnalysisHistoryPageApi["getAnalysis"]>()
        .mockResolvedValueOnce(analysis)
        .mockRejectedValueOnce(new Error("refresh failed")),
    });
    const container = await render(historyApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-analysis]")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-archive-analysis]")?.click(),
    );
    expect(container.querySelector("[role='status']")?.textContent).toContain(
      "归档已完成，但刷新失败",
    );
    expect(container.querySelector(".analysis-history-detail h2")).not.toBeNull();

    const failed = api({
      archiveAnalysis: vi.fn(async () => {
        throw new Error("conflict");
      }),
    });
    const second = await render(failed);
    await act(async () => second.querySelector<HTMLButtonElement>("[data-open-analysis]")?.click());
    await act(async () =>
      second.querySelector<HTMLButtonElement>("[data-archive-analysis]")?.click(),
    );
    expect(second.querySelector("[role='alert']")?.textContent).toContain("操作失败");
    expect(second.querySelector(".analysis-history-detail h2")).not.toBeNull();
  });

  it("requires two-step deletion and suppresses stale detail", async () => {
    let resolve!: (value: AnalysisRecord) => void;
    const older = new Promise<AnalysisRecord>((done) => {
      resolve = done;
    });
    const newer = {
      ...analysis,
      id: "analysis-2",
      source: { ...analysis.source, title: "Newer title" },
      sourceText: "Newer source.",
    };
    const historyApi = api({
      getAnalysis: vi
        .fn<AnalysisHistoryPageApi["getAnalysis"]>()
        .mockImplementationOnce(() => older)
        .mockResolvedValueOnce(newer),
      listHistory: vi.fn(async () => ({ items: [analysis, newer], nextCursor: null })),
    });
    const container = await render(historyApi);
    const opens = container.querySelectorAll<HTMLButtonElement>("[data-open-analysis]");
    await act(async () => opens[0]?.click());
    await act(async () => opens[1]?.click());
    await act(async () => resolve(analysis));
    expect(container.querySelector(".analysis-history-detail")?.textContent).toContain(
      "Newer source.",
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-delete-analysis]")?.click(),
    );
    expect(historyApi.deleteAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>("[data-confirm-delete]")).toBe(
      document.activeElement,
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-delete]")?.click(),
    );
    expect(historyApi.deleteAnalysis).toHaveBeenCalledOnce();
    expect(historyApi.deleteAnalysis).toHaveBeenCalledWith("analysis-2", 1, "key-1", false);
  });

  it("defaults linked analysis deletion to deleting its StudyCapture but allows opting out", async () => {
    const linked = analysisRecordSchema.parse({
      ...analysis,
      source: { type: "study-capture" },
      studyCaptureId: "capture-1",
    });
    const historyApi = api({
      getAnalysis: vi.fn(async () => linked),
      listHistory: vi.fn(async () => ({ items: [linked], nextCursor: null })),
    });
    const container = await render(historyApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-open-analysis]")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-delete-analysis]")?.click(),
    );
    const checkbox = container.querySelector<HTMLInputElement>("[name=deleteStudyCapture]");
    expect(checkbox?.checked).toBe(true);
    await act(async () => checkbox?.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-delete]")?.click(),
    );
    expect(historyApi.deleteAnalysis).toHaveBeenCalledWith("analysis-1", 1, "key-1", false);
  });

  it("suppresses stale list and action responses", async () => {
    let resolveList!: (value: Awaited<ReturnType<AnalysisHistoryPageApi["listHistory"]>>) => void;
    const olderList = new Promise<Awaited<ReturnType<AnalysisHistoryPageApi["listHistory"]>>>(
      (done) => {
        resolveList = done;
      },
    );
    const newer = {
      ...analysis,
      id: "analysis-2",
      source: { ...analysis.source, title: "Newer title" },
      sourceText: "Newer source.",
    };
    const listApi = api({
      listHistory: vi
        .fn<AnalysisHistoryPageApi["listHistory"]>()
        .mockImplementationOnce(() => olderList)
        .mockResolvedValueOnce({ items: [newer], nextCursor: null }),
    });
    const first = await render(listApi);
    const archived = first.querySelector<HTMLSelectElement>("[name='archived']");
    if (archived === null) throw new Error("Archived filter missing.");
    await select(archived, "true");
    await act(async () => first.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listApi.listHistory).toHaveBeenCalledTimes(2);
    await act(async () => resolveList({ items: [analysis], nextCursor: null }));
    expect(first.textContent).toContain("Newer title");
    expect(first.textContent).not.toContain("Writing notes");

    let resolveArchive!: (value: AnalysisRecord) => void;
    const archive = new Promise<AnalysisRecord>((done) => {
      resolveArchive = done;
    });
    const actionApi = api({
      archiveAnalysis: vi.fn(() => archive),
      getAnalysis: vi.fn(async (id) =>
        id === newer.id ? newer : { ...analysis, id: "analysis-1" },
      ),
      listHistory: vi.fn(async () => ({
        items: [{ ...analysis, id: "analysis-1" }, newer],
        nextCursor: null,
      })),
    });
    const second = await render(actionApi);
    const opens = second.querySelectorAll<HTMLButtonElement>("[data-open-analysis]");
    await act(async () => opens[0]?.click());
    await act(async () =>
      second.querySelector<HTMLButtonElement>("[data-archive-analysis]")?.click(),
    );
    await act(async () => opens[1]?.click());
    await act(async () =>
      resolveArchive({ ...analysis, archivedAt: analysis.createdAt, revision: 2 }),
    );
    expect(second.querySelector(".analysis-history-detail")?.textContent).toContain(
      "Newer source.",
    );
    expect(second.querySelector(".analysis-history-status")?.textContent).toBe("");
  });

  it("shows retryable error and empty states", async () => {
    const historyApi = api({
      listHistory: vi
        .fn<AnalysisHistoryPageApi["listHistory"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [], nextCursor: null }),
    });
    const container = await render(historyApi);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入分析历史");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-history]")?.click(),
    );
    expect(container.textContent).toContain("当前筛选下没有分析记录");
  });
});
