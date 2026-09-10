import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  analysisRecordSchema,
  contractFixtures,
  type AnalysisRecord,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { StudyInbox } from "./study-inbox.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const first = analysisRecordSchema.parse({
  ...contractFixtures.analysis,
  source: { ...contractFixtures.analysis.source, title: undefined },
});
const next = { ...first, id: "analysis-next", sourceText: "Next ready sentence." };
const pending: StudyCaptureDetailResponse = {
  capture: {
    id: "pending-capture",
    kind: "sentence",
    sourceText: "Unanalyzed original.",
    status: "pending",
    revision: 1,
    captureCount: 1,
    normalizedTextHash: "a".repeat(64),
    createdAt: first.createdAt,
    updatedAt: first.createdAt,
    firstCapturedAt: first.createdAt,
    lastCapturedAt: first.createdAt,
  },
  latestAnalysis: null,
  activeAnalysisRequest: null,
};
const reviewed = (record: AnalysisRecord) => ({
  ...record,
  reviewState: "reviewed" as const,
  revision: record.revision + 1,
});
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
function fixture(records = [first, next], captures: StudyCaptureDetailResponse[] = []) {
  const review: InboxApi = {
    listPending: vi.fn(async () => ({ items: records, nextCursor: null })),
    getAnalysis: vi.fn(async (id) => records.find((record) => record.id === id) ?? first),
    confirmCandidates: vi.fn(async (id) => ({
      analysis: reviewed(records.find((record) => record.id === id) ?? first),
      results: [],
    })),
    processNothingToSave: vi.fn(async (id) =>
      reviewed(records.find((record) => record.id === id) ?? first),
    ),
  };
  const api: WebStudyCaptureApi = {
    listCaptures: vi.fn(async (query) => ({
      items: captures.filter((entry) => entry.capture.status === query.status),
      nextCursor: null,
    })),
    getCapture: vi.fn(async () => pending),
    patchCapture: vi.fn(),
    deleteCapture: vi.fn(),
    analyzeCapture: vi.fn(),
    getAnalysisRequestStatus: vi.fn(),
  };
  return { api, review };
}
async function render(f: ReturnType<typeof fixture>) {
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () => root?.render(<StudyInbox captureApi={f.api} reviewApi={f.review} />));
  return view;
}
async function click(view: Element, text: string) {
  const button = [...view.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
async function change(view: Element, selector: string, value: string) {
  const input = view.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!input) throw new Error(`Missing input: ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
const actions = ["加入学习库", "这条无需学习"];
it.each(actions)(
  "%s automatically opens the next ready item, skipping pending and generating originals",
  async (action) => {
    const generating = {
      ...pending,
      capture: {
        ...pending.capture,
        id: "generating",
        sourceText: "Generating original.",
        status: "analyzing" as const,
      },
    };
    const f = fixture([first, next], [pending, generating]);
    const view = await render(f);
    await click(view, first.sourceText);
    await click(view, action);
    expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(next.sourceText);
    expect(view.querySelector("aside [aria-pressed=true]")?.textContent).toContain(next.sourceText);
    expect(view.textContent).not.toContain("已整理到学习库");
    expect(view.textContent).not.toContain("继续整理");
    expect(view.querySelectorAll("aside button")).toHaveLength(3);
  },
);
it.each(actions)(
  "%s ends with a practice navigation and no completed detail when no ready items remain",
  async (action) => {
    const f = fixture([first], [pending]);
    const view = await render(f);
    await click(view, first.sourceText);
    await click(view, action);
    expect(view.querySelector(".analysis-detail")).toBeNull();
    expect(view.textContent).toContain("没有待选择的学习内容");
    expect(view.querySelector<HTMLAnchorElement>('a[href="/practice"]')?.textContent).toBe(
      "去练习",
    );
    expect(view.textContent).not.toContain("继续整理");
    expect(view.textContent).not.toContain("已整理到学习库");
    expect(view.querySelector("aside button")?.textContent).toContain(pending.capture.sourceText);
    await click(view, pending.capture.sourceText);
    expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(pending.capture.sourceText);
    expect(view.textContent).not.toContain("没有待选择的学习内容");
  },
);
it.each(actions)("%s failure retains current candidate edits and selection", async (action) => {
  const f = fixture();
  f.review.confirmCandidates = vi.fn(async () => {
    throw new Error("offline");
  });
  f.review.processNothingToSave = vi.fn(async () => {
    throw new Error("offline");
  });
  const view = await render(f);
  const selector = ".candidate-card input:not([type=checkbox])";
  await change(view, selector, "My unsaved expression");
  await click(view, action);
  expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(first.sourceText);
  expect(view.querySelector<HTMLInputElement>(selector)?.value).toBe("My unsaved expression");
  expect(view.querySelector("[role=alert]")?.textContent).toContain("未完成");
  expect(view.querySelector("aside [aria-pressed=true]")?.textContent).toContain(first.sourceText);
});
it.each(actions)(
  "%s completion does not steal navigation after selection changes in flight",
  async (action) => {
    const f = fixture([first, next], [pending]);
    let finish: () => void = () => undefined;
    const result = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.review.confirmCandidates = vi.fn(async () => {
      await result;
      return { analysis: reviewed(first), results: [] };
    });
    f.review.processNothingToSave = vi.fn(async () => {
      await result;
      return reviewed(first);
    });
    const view = await render(f);
    await click(view, first.sourceText);
    await click(view, action);
    await click(view, pending.capture.sourceText);
    await change(view, "input[name=title]", "Unfinished title draft");
    await act(async () => finish());
    expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(pending.capture.sourceText);
    expect(view.querySelector<HTMLInputElement>("input[name=title]")?.value).toBe(
      "Unfinished title draft",
    );
    expect(view.textContent).not.toContain("没有待选择的学习内容");
    expect(view.querySelectorAll("aside button")).toHaveLength(2);
  },
);
it("keeps pagination available without claiming the whole queue is finished, then opens loaded ready content", async () => {
  const f = fixture([first]);
  f.review.listPending = vi.fn(async (query) =>
    query?.cursor
      ? { items: [next], nextCursor: null }
      : { items: [first], nextCursor: "next-page" },
  );
  const view = await render(f);
  await click(view, "这条无需学习");
  expect(view.textContent).toContain("还有内容未载入");
  expect(view.querySelector(".analysis-detail")).toBeNull();
  await click(view, "载入更多");
  expect(f.review.listPending).toHaveBeenCalledWith({ cursor: "next-page" });
  expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(next.sourceText);
  expect(view.textContent).not.toContain("还有内容未载入");
});
it("keeps completion on refresh and still allows opening reviewed content manually", async () => {
  const attached = { ...first, studyCaptureId: "attached" };
  const capture: StudyCaptureDetailResponse = {
    ...pending,
    capture: {
      ...pending.capture,
      id: "attached",
      status: "analyzed",
      sourceText: first.sourceText,
    },
    latestAnalysis: {
      id: first.id,
      revision: first.revision,
      createdAt: first.createdAt,
      reviewState: first.reviewState,
    },
  };
  const f = fixture([attached], [capture]);
  const view = await render(f);
  await click(view, "加入学习库");
  f.review.listPending = vi.fn(async () => ({ items: [], nextCursor: null }));
  f.review.getAnalysis = vi.fn(async () => reviewed(attached));
  capture.latestAnalysis = {
    ...capture.latestAnalysis,
    id: first.id,
    createdAt: first.createdAt,
    revision: first.revision + 1,
    reviewState: "reviewed",
  };
  await click(view, "刷新列表");
  expect(view.querySelector(".analysis-detail")).toBeNull();
  expect(view.textContent).toContain("没有待选择的学习内容");
  await change(view, ".study-inbox-toolbar select", "all");
  await click(view, first.sourceText);
  expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(first.sourceText);
  expect(view.textContent).toContain("已整理到学习库");
  expect(view.textContent).not.toContain("继续整理");
});

it("clears completed-analysis feedback when review advances", async () => {
  const f = fixture([first]);
  const capture: StudyCaptureDetailResponse = {
    ...pending,
    capture: { ...pending.capture, status: "analyzing" },
    activeAnalysisRequest: { requestId: "request-1", state: "running" },
  };
  f.api.listCaptures = vi.fn(async (query) => ({
    items: query.status === "analyzing" ? [capture] : [],
    nextCursor: null,
  }));
  f.api.getAnalysisRequestStatus = vi.fn(async () => ({
    state: "completed" as const,
    requestId: "request-1",
    analysisId: first.id,
  }));
  f.api.getCapture = vi.fn(async () => ({
    ...capture,
    capture: { ...capture.capture, status: "analyzed" as const },
    activeAnalysisRequest: null,
    latestAnalysis: {
      id: first.id,
      revision: first.revision,
      createdAt: first.createdAt,
      reviewState: first.reviewState,
    },
  }));
  const view = await render(f);
  await click(view, "检查同一次分析");
  expect(view.querySelector("[role=status]")?.textContent).toContain("分析已完成");
  await click(view, "这条无需学习");
  expect(view.textContent).not.toContain("分析已完成，请选择");
  expect(view.textContent).toContain("没有待选择的学习内容");
});
it("automatically opens the next ready item's existing edits", async () => {
  const f = fixture();
  const view = await render(f);
  const selector = ".candidate-card input:not([type=checkbox])";
  await click(view, next.sourceText);
  await change(view, selector, "Next item's unsaved draft");
  await click(view, first.sourceText);
  await click(view, "加入学习库");
  expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(next.sourceText);
  expect(view.querySelector<HTMLInputElement>(selector)?.value).toBe("Next item's unsaved draft");
});
