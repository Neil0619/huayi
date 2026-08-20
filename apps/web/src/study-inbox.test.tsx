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
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
    await click(
      [...container.querySelectorAll("[role=tab]")].find((item) => item.textContent === "待收藏") ??
        null,
    );
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("待整理箱已经清空");
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
  });
});
