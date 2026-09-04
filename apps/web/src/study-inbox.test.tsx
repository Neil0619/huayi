import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudyInbox } from "./study-inbox.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capture = {
  captureCount: 2,
  createdAt: "2026-08-13T00:00:00.000Z",
  firstCapturedAt: "2026-08-13T00:00:00.000Z",
  id: "capture-1",
  kind: "sentence" as const,
  lastCapturedAt: "2026-08-13T00:01:00.000Z",
  normalizedTextHash: "a".repeat(64),
  revision: 1,
  sourceText: "This is worth learning.",
  status: "pending" as const,
  updatedAt: "2026-08-13T00:01:00.000Z",
};

let root: Root | undefined;
afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  document.body.replaceChildren();
});

async function renderInbox(captureApi: object) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StudyInbox
        captureApi={captureApi as never}
        createIdempotencyKey={() => "write-key"}
        reviewApi={{
          confirmCandidates: vi.fn(),
          getAnalysis: vi.fn(),
          listPending: vi.fn(async () => ({ items: [], nextCursor: null })),
          processNothingToSave: vi.fn(),
        }}
      />,
    );
    await Promise.resolve();
  });
  return container;
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("Missing clickable element.");
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

describe("StudyInbox", () => {
  it("shows an analysis in progress when returning to the default inbox", async () => {
    const detail = {
      capture: { ...capture, status: "analyzing" },
      latestAnalysis: null,
      activeAnalysisRequest: { requestId: "request-1", state: "running" },
    };
    const api = {
      analyzeCapture: vi.fn(),
      getCapture: vi.fn(async () => detail),
      listCaptures: vi.fn(async (query: { status: string }) => ({
        items: query.status === "analyzing" ? [detail] : [],
        nextCursor: null,
      })),
    };
    const container = await renderInbox(api);
    expect(container.textContent).toContain(capture.sourceText);
    expect(container.textContent).toContain("分析中");
    expect(container.querySelector("[data-recheck-analysis]")).not.toBeNull();
    expect(api.analyzeCapture).not.toHaveBeenCalled();
  });

  it.each(["stream", "recovery"])(
    "keeps the failed capture and error visible after %s completion",
    async (failurePath) => {
      const detail = { capture, latestAnalysis: null };
      const failure = {
        code: "model_output_invalid",
        message: "Invalid output.",
        requestId: "request-1",
      };
      const api = {
        analyzeCapture: vi.fn(async function* () {
          yield { requestId: "request-1", type: "analysis.started" as const, unitCount: 1 };
          if (failurePath === "stream") yield { error: failure, type: "analysis.failed" as const };
        }),
        getAnalysisRequestStatus: vi.fn(async () => ({
          error: failure,
          requestId: "request-1",
          state: "failed",
        })),
        getCapture: vi.fn(async () => detail),
        listCaptures: vi.fn(async () => ({ items: [detail], nextCursor: null })),
      };
      const container = await renderInbox(api);
      await click(container.querySelector("[data-analyze-capture]"));
      expect(container.querySelector("[role=alert]")?.textContent).toContain("原文已保留");
      expect(container.textContent).not.toContain("服务器正在生成");
      expect(container.textContent).toContain(capture.sourceText);
      expect(container.querySelector<HTMLButtonElement>("[data-analyze-capture]")?.disabled).toBe(
        false,
      );
      expect(api.analyzeCapture).toHaveBeenCalledTimes(1);
    },
  );

  it("loads captures, saves edits, and starts explicit analysis", async () => {
    const detail = { capture, latestAnalysis: null };
    const api = {
      analyzeCapture: vi.fn(async function* () {
        yield { requestId: "request-1", type: "analysis.started" as const, unitCount: 1 };
        yield { analysis: { id: "analysis-1" }, type: "analysis.completed" as const };
      }),
      deleteCapture: vi.fn(async () => ({ deleted: true as const, id: capture.id })),
      getCapture: vi.fn(async () => detail),
      listCaptures: vi.fn(async () => ({ items: [detail], nextCursor: null })),
      patchCapture: vi.fn(async () => ({
        capture: { ...capture, revision: 2, title: "Useful line" },
        latestAnalysis: null,
      })),
    };
    const container = await renderInbox(api);
    expect(container.textContent).toContain("This is worth learning.");
    const title = container.querySelector<HTMLInputElement>("[name=title]");
    if (title === null) throw new Error("Missing title field.");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(title, "Useful line");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(container.querySelector("[data-save-capture]"));
    expect(api.patchCapture).toHaveBeenCalled();
    await click(container.querySelector("[data-analyze-capture]"));
    expect(api.analyzeCapture).toHaveBeenCalledWith(
      "capture-1",
      { expectedRevision: 2, intent: "initial" },
      "write-key",
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("待整理箱已经清空");
  });

  it("requires a second confirmation before deleting a pending capture", async () => {
    const detail = { capture, latestAnalysis: null };
    const api = {
      analyzeCapture: vi.fn(),
      deleteCapture: vi.fn(async () => ({ deleted: true as const, id: capture.id })),
      getCapture: vi.fn(async () => detail),
      listCaptures: vi.fn(async () => ({ items: [detail], nextCursor: null })),
      patchCapture: vi.fn(),
    };
    const container = await renderInbox(api);
    await click(container.querySelector("[data-delete-capture]"));
    expect(api.deleteCapture).not.toHaveBeenCalled();
    await click(container.querySelector("[data-confirm-delete-capture]"));
    expect(api.deleteCapture).toHaveBeenCalledWith("capture-1", 1, "write-key");
  });

  it("recovers a disconnected stream from the same durable request", async () => {
    const detail = { capture, latestAnalysis: null };
    const api = {
      analyzeCapture: vi.fn(async function* () {
        yield { requestId: "request-1", type: "analysis.started" as const, unitCount: 1 };
      }),
      deleteCapture: vi.fn(),
      getAnalysisRequestStatus: vi.fn(async () => ({
        analysisId: "analysis-1",
        requestId: "request-1",
        state: "completed" as const,
      })),
      getCapture: vi.fn(async () => detail),
      listCaptures: vi.fn(async () => ({ items: [detail], nextCursor: null })),
      patchCapture: vi.fn(),
    };
    const container = await renderInbox(api);
    await click(container.querySelector("[data-analyze-capture]"));
    expect(api.getAnalysisRequestStatus).toHaveBeenCalledWith("request-1");
    expect(container.textContent).toContain("待整理箱已经清空");
  });

  it("switches explicitly from pending analysis to pending collection", async () => {
    const container = await renderInbox({
      deleteCapture: vi.fn(),
      getCapture: vi.fn(),
      listCaptures: vi.fn(async () => ({ items: [], nextCursor: null })),
      patchCapture: vi.fn(),
    });
    expect(container.textContent).toContain("还没有待分析内容");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector(".study-inbox-toolbar .capture-status-filter")).not.toBeNull();
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
    await click(
      [...container.querySelectorAll("[role=tab]")].find((item) => item.textContent === "待收藏") ??
        null,
    );
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("待整理箱已经清空");
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
  });

  it("keeps tab buttons and keyboard focus stable across both classifications", async () => {
    const container = await renderInbox({
      listCaptures: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    const tabs = [...container.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    for (const name of ["待收藏", "待分析"]) {
      const tab = tabs.find((item) => item.textContent === name);
      if (tab === undefined) throw new Error("Missing inbox tab.");
      tab.focus();
      await click(tab);
      expect(document.activeElement).toBe(tab);
      expect(tab.isConnected).toBe(true);
      expect(tab.getAttribute("aria-selected")).toBe("true");
    }
  });
});
