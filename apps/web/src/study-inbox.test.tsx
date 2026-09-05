import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  analysisRecordSchema,
  confirmCandidatesResponseSchema,
  contractFixtures,
  LearningTaskError,
  type LearningTaskSnapshot,
  type LearningTaskPayload,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { StudyInbox } from "./study-inbox.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const analysis = analysisRecordSchema.parse({
  ...contractFixtures.analysis,
  studyCaptureId: "capture-1",
});
const date = "2026-09-05T00:00:00.000Z";
const detail: StudyCaptureDetailResponse = {
  capture: {
    captureCount: 1,
    createdAt: date,
    firstCapturedAt: date,
    id: "capture-1",
    kind: "sentence",
    lastCapturedAt: date,
    normalizedTextHash: "a".repeat(64),
    revision: 1,
    sourceText: analysis.sourceText,
    status: "pending",
    updatedAt: date,
  },
  latestAnalysis: null,
  activeAnalysisRequest: null,
};
const job: LearningTaskSnapshot = {
  version: 2,
  id: "task-1",
  kind: "capture-analysis",
  subjectId: detail.capture.id,
  state: "queued",
  cursor: 0,
  createdAt: date,
  updatedAt: date,
  error: null,
  output: null,
  timings: {},
};
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
function setup(overrides: Partial<WebStudyCaptureApi> = {}, reviews: Partial<InboxApi> = {}) {
  const tasks = {
    submit: vi.fn(async () => job),
    list: vi.fn(async (): Promise<LearningTaskSnapshot[]> => []),
    get: vi.fn(async () => job),
    cancel: vi.fn(async () => ({ ...job, state: "cancelled" as const })),
    watch: vi.fn(async function* (): AsyncIterable<LearningTaskPayload> {
      yield {
        type: "analysis.preview" as const,
        requestId: "request-1",
        text: "先理解原文",
        section: "overall" as const,
      };
    }),
  };
  const api: WebStudyCaptureApi = {
    tasks,
    analyzeCapture: vi.fn(),
    getAnalysisRequestStatus: vi.fn(),
    getCapture: vi.fn(async () => detail),
    listCaptures: vi.fn(async (query) => ({
      items: query.status === "pending" ? [detail] : [],
      nextCursor: null,
    })),
    patchCapture: vi.fn(async (_id, input) => ({
      ...detail,
      capture: { ...detail.capture, title: input.title ?? undefined, revision: 2 },
    })),
    deleteCapture: vi.fn(async () => ({ deleted: true as const, id: detail.capture.id })),
    ...overrides,
  };
  const review: InboxApi = {
    confirmCandidates: vi.fn(async () =>
      confirmCandidatesResponseSchema.parse(contractFixtures.confirmCandidatesResponse),
    ),
    getAnalysis: vi.fn(async () => analysis),
    listPending: vi.fn(async () => ({ items: [], nextCursor: null })),
    processNothingToSave: vi.fn(async () => ({
      ...analysis,
      reviewState: "reviewed" as const,
      revision: 2,
    })),
    ...reviews,
  };
  return { api, review, tasks };
}
async function render(fixture: ReturnType<typeof setup>) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StudyInbox
        captureApi={fixture.api}
        reviewApi={fixture.review}
        createIdempotencyKey={() => "write-key"}
      />,
    );
  });
  return container;
}
async function click(container: Element, selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  await act(async () => {
    button.click();
  });
}
async function change(container: Element, selector: string, text: string) {
  const field = container.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`Missing ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("loads a single continuous collection and never starts a model on entry", async () => {
  const f = setup();
  const view = await render(f);
  expect(view.querySelectorAll("h1")).toHaveLength(1);
  expect(view.textContent).toContain("收集箱");
  expect(view.querySelectorAll("aside button")).toHaveLength(1);
  expect(f.tasks.submit).not.toHaveBeenCalled();
  expect(f.api.analyzeCapture).not.toHaveBeenCalled();
});
it("saves edited metadata before queuing explicit analysis and keeps navigation enabled", async () => {
  const f = setup();
  const view = await render(f);
  await change(view, "[name=title]", "Useful line");
  await act(async () => {
    view.querySelector<HTMLButtonElement>("[data-analyze-capture]")?.click();
    view.querySelector<HTMLButtonElement>("[data-analyze-capture]")?.click();
  });
  expect(f.api.patchCapture).toHaveBeenCalledWith(
    "capture-1",
    expect.objectContaining({ title: "Useful line" }),
    "write-key",
  );
  expect(f.tasks.submit).toHaveBeenCalledExactlyOnceWith(
    {
      version: 2,
      kind: "capture-analysis",
      captureId: "capture-1",
      input: { expectedRevision: 2, intent: "initial" },
    },
    "write-key",
  );
  expect(view.textContent).toContain("先理解原文");
  expect(view.querySelector<HTMLButtonElement>("aside button")?.disabled).toBe(false);
});
it("restores a running task after leaving without submitting again", async () => {
  const f = setup();
  f.tasks.list.mockResolvedValue([job]);
  const first = await render(f);
  expect(first.textContent).toContain("可以切换内容或离开");
  await act(async () => root?.unmount());
  const next = await render(f);
  expect(next.textContent).toContain("先理解原文");
  expect(f.tasks.watch).toHaveBeenCalledTimes(2);
  expect(f.tasks.submit).not.toHaveBeenCalled();
  expect(f.tasks.cancel).not.toHaveBeenCalled();
});
it.each(["model_output_invalid", "outcome_unknown"])(
  "keeps failed original text, recovery classification and diagnostic for %s",
  async (code) => {
    const f = setup();
    f.tasks.watch.mockImplementation(async function* () {
      yield {
        type: "analysis.preview" as const,
        requestId: "request-1",
        text: "仍保留预览",
        section: "overall" as const,
      };
      throw new LearningTaskError(code, "diagnostic-1");
    });
    const view = await render(f);
    await click(view, "[data-analyze-capture]");
    expect(view.querySelector("[role=alert]")?.textContent).toContain("原文已保留");
    expect(view.textContent).toContain("diagnostic-1");
    expect(view.textContent).toContain(detail.capture.sourceText);
  },
);
it("requires a second confirmation before deleting an original", async () => {
  const f = setup();
  const view = await render(f);
  await click(view, "[data-delete-capture]");
  expect(f.api.deleteCapture).not.toHaveBeenCalled();
  await click(view, "[data-confirm-delete-capture]");
  expect(f.api.deleteCapture).toHaveBeenCalledWith("capture-1", 1, "write-key");
  expect(view.textContent).toContain("从一句你想学会使用的话开始");
});
it("keeps edited candidates when switching to another original and back", async () => {
  const another = {
    ...analysis,
    id: "analysis-2",
    studyCaptureId: "capture-2",
    sourceText: "Another sentence.",
  };
  const f = setup(
    {},
    { listPending: vi.fn(async () => ({ items: [analysis, another], nextCursor: null })) },
  );
  const first = {
    ...detail,
    latestAnalysis: {
      id: analysis.id,
      reviewState: analysis.reviewState,
      createdAt: date,
      revision: analysis.revision,
    },
  };
  f.api.listCaptures = vi.fn(async (query) => ({
    items: query.status === "pending" ? [first] : [],
    nextCursor: null,
  }));
  const view = await render(f);
  const field = view.querySelector<HTMLInputElement>(".candidate-card input:not([type=checkbox])");
  // Candidate editors keep source-linked edits in the same item when browsed elsewhere.
  expect(field).not.toBeNull();
  await change(view, ".candidate-card input:not([type=checkbox])", "My edited expression");
  const buttons = view.querySelectorAll<HTMLButtonElement>("aside button");
  await act(async () => buttons[1]?.click());
  await act(async () => buttons[0]?.click());
  expect(
    view.querySelector<HTMLInputElement>(".candidate-card input:not([type=checkbox])")?.value,
  ).toBe("My edited expression");
  expect(view.textContent).toContain("选择你想学会使用的表达与句型");
});
it("offers paste capture when empty without introducing a second primary navigation", async () => {
  const f = setup({ listCaptures: vi.fn(async () => ({ items: [], nextCursor: null })) });
  const view = await render(f);
  expect(view.textContent).toContain("粘贴第一条原文");
  expect(view.querySelector("nav[aria-label=主导航]")).toBeNull();
});
