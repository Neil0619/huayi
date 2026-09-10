import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { LearningTaskSnapshot, StudyCaptureDetailResponse } from "@huayi/cloud-contracts";
import { CollectionWorkspace } from "./collection-workspace.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const date = "2026-09-10T00:00:00.000Z";
const original = { source: "A useful sentence.", title: "My title", context: "My context" };
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
    sourceText: original.source,
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
  subjectId: "capture-1",
  state: "queued",
  cursor: 0,
  createdAt: date,
  updatedAt: date,
  error: null,
  output: null,
  timings: {},
};
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const tasks = {
    submit: vi.fn(async () => job),
    list: vi.fn(async (): Promise<LearningTaskSnapshot[]> => []),
    get: vi.fn(async () => job),
    cancel: vi.fn(async () => job),
    watch: vi.fn<NonNullable<WebStudyCaptureApi["tasks"]>["watch"]>(async function* () {
      yield {
        type: "analysis.preview",
        requestId: "request-1",
        text: "Still generating",
        section: "overall",
      };
    }),
  };
  const api = {
    tasks,
    createCapture: vi.fn(async () => ({ outcome: "existing" as const, capture: detail.capture })),
    getCapture: vi.fn(async () => detail),
    patchCapture: vi.fn<WebStudyCaptureApi["patchCapture"]>(async (_id, input) => ({
      ...detail,
      capture: {
        ...detail.capture,
        title: input.title ?? undefined,
        userContext: input.userContext ?? undefined,
        revision: 2,
      },
    })),
    listCaptures: vi.fn(async () => ({ items: [], nextCursor: null })),
    analyzeCapture: vi.fn(),
    getAnalysisRequestStatus: vi.fn(),
    deleteCapture: vi.fn(),
  } satisfies WebStudyCaptureApi;
  const review: InboxApi = {
    listPending: vi.fn(async () => ({ items: [], nextCursor: null })),
    getAnalysis: vi.fn(),
    confirmCandidates: vi.fn(),
    processNothingToSave: vi.fn(),
  };
  return { api, review, tasks };
}
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
async function render(f: ReturnType<typeof fixture>) {
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () =>
    root?.render(
      <CollectionWorkspace
        captureApi={f.api}
        reviewApi={f.review}
        pasteDefault
        createIdempotencyKey={() => "write-key"}
      />,
    ),
  );
  await edit(view, "[name=sourceText]", original.source);
  await edit(view, ".collection-paste input", original.title);
  await edit(view, ".collection-paste details textarea", original.context);
  return view;
}
async function edit(view: Element, selector: string, value: string) {
  const field = view.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector,
  );
  if (!field) throw new Error(`Missing ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
async function submit(view: Element) {
  await act(async () =>
    view
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function draft(view: Element) {
  return {
    source: view.querySelector<HTMLTextAreaElement>("[name=sourceText]")?.value,
    title: view.querySelector<HTMLInputElement>(".collection-paste input")?.value,
    context: view.querySelector<HTMLTextAreaElement>(".collection-paste details textarea")?.value,
  };
}
it("clears submitted text and context only once saving and task acceptance succeed, before model completion", async () => {
  const f = fixture();
  const saved = deferred<Awaited<ReturnType<typeof f.api.createCapture>>>();
  const accepted = deferred<LearningTaskSnapshot>();
  f.api.createCapture.mockReturnValue(saved.promise);
  f.tasks.submit.mockReturnValue(accepted.promise);
  const view = await render(f);
  await submit(view);
  expect(draft(view)).toEqual(original);
  await act(async () => saved.resolve({ outcome: "existing", capture: detail.capture }));
  expect(draft(view)).toEqual(original);
  expect(f.tasks.submit).toHaveBeenCalledTimes(1);
  await act(async () => accepted.resolve(job));
  expect(draft(view)).toEqual({ source: "", title: "", context: "" });
  expect(view.textContent).toContain("Still generating");
  expect(view.querySelector(".analysis-detail")?.textContent).toContain(original.source);
  expect(view.querySelector<HTMLButtonElement>(".collection-paste [type=submit]")?.disabled).toBe(
    true,
  );
  await edit(view, "[name=sourceText]", "The next sentence.");
  expect(view.querySelector<HTMLButtonElement>(".collection-paste [type=submit]")?.disabled).toBe(
    false,
  );
});
it.each(["createCapture", "getCapture", "patchCapture", "submit"] as const)(
  "retains the complete draft when %s fails",
  async (stage) => {
    const f = fixture();
    const operation = stage === "submit" ? f.tasks.submit : f.api[stage];
    operation.mockRejectedValue(new Error("Rejected"));
    const view = await render(f);
    await submit(view);
    expect(draft(view)).toEqual(original);
    expect(view.querySelector("[role=alert]")?.textContent).toContain("当前草稿已保留");
    expect(view.querySelector<HTMLButtonElement>(".collection-paste [type=submit]")?.disabled).toBe(
      false,
    );
  },
);
it.each([
  ["[name=sourceText]", "A newer sentence.", "source"],
  [".collection-paste input", "A newer title", "title"],
  [".collection-paste details textarea", "A newer context", "context"],
] as const)(
  "preserves the draft when %s is edited during task submission",
  async (selector, text, field) => {
    const f = fixture();
    const accepted = deferred<LearningTaskSnapshot>();
    f.tasks.submit.mockReturnValue(accepted.promise);
    const view = await render(f);
    await submit(view);
    await edit(view, selector, text);
    await act(async () => accepted.resolve(job));
    expect(draft(view)).toEqual({ ...original, [field]: text });
    expect(view.textContent).toContain("Still generating");
  },
);
it("preserves a later edit even if the user restores the submitted text", async () => {
  const f = fixture();
  const accepted = deferred<LearningTaskSnapshot>();
  f.tasks.submit.mockReturnValue(accepted.promise);
  const view = await render(f);
  await submit(view);
  await edit(view, "[name=sourceText]", "Another sentence.");
  await edit(view, "[name=sourceText]", original.source);
  await act(async () => accepted.resolve(job));
  expect(draft(view)).toEqual(original);
});
it("does not clear a draft after save-only or when content type changes while starting", async () => {
  const f = fixture();
  const view = await render(f);
  await act(async () =>
    view.querySelector<HTMLButtonElement>(".collection-paste button[type=button]")?.click(),
  );
  expect(draft(view)).toEqual(original);
  expect(f.tasks.submit).not.toHaveBeenCalled();
  const accepted = deferred<LearningTaskSnapshot>();
  f.tasks.submit.mockReturnValue(accepted.promise);
  await submit(view);
  await edit(view, ".collection-paste select", "passage");
  await act(async () => accepted.resolve(job));
  expect(draft(view)).toEqual(original);
  expect(view.querySelector<HTMLSelectElement>(".collection-paste select")?.value).toBe("passage");
});
