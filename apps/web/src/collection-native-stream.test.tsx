import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  contractFixtures,
  type LearningTaskSnapshotRead,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { CollectionWorkspace } from "./collection-workspace.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
import type { InboxApi } from "./inbox-app.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
function fixture(foreign = false, currentKind: "sentence" | "passage" = "passage") {
  const native = nativeWebAnalysis();
  const analysis = { ...native, sourceText: native.sourceText.trim(), studyCaptureId: "capture-1" };
  if (analysis.result.type !== "sentence-passage-analysis-v3" || !analysis.result.sentences[0])
    throw new Error("fixture");
  const sentence = analysis.result.sentences[0];
  const capture: StudyCaptureDetailResponse = {
    capture: {
      id: "capture-1",
      kind: currentKind,
      sourceText: analysis.sourceText,
      revision: 1,
      status: "analyzing",
      captureCount: 1,
      normalizedTextHash: "a".repeat(64),
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
      firstCapturedAt: analysis.createdAt,
      lastCapturedAt: analysis.updatedAt,
    },
    activeAnalysisRequest: null,
    latestAnalysis: null,
  };
  const task: LearningTaskSnapshotRead = {
    version: 2,
    id: "task-1",
    kind: "capture-analysis",
    subjectId: "capture-1",
    state: "running",
    cursor: 1,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    error: null,
    output: null,
    timings: {},
  };
  let finish: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const output = { ...contractFixtures.completedEvent, analysis };
  const tasks: NonNullable<WebStudyCaptureApi["analysisTasks"]> = {
    submit: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(async () => [task]),
    watch: vi.fn(async function* (_id, _signal, snapshot) {
      yield {
        type: "analysis.structure" as const,
        requestId: "request-1",
        unit: {
          analysisUnitId: sentence.analysisUnitId,
          ordinal: sentence.ordinal,
          sourceText: sentence.sourceText,
          sentenceStructure: sentence.sentenceStructure,
        },
      };
      await wait;
      snapshot?.({ ...task, id: foreign ? "other-task" : task.id, state: "completed", output });
      yield output;
    }),
  };
  const api: WebStudyCaptureApi = {
    analysisTasks: tasks,
    listCaptures: vi.fn(async (query) => ({
      items: query.status === "analyzing" ? [capture] : [],
      nextCursor: null,
    })),
    getCapture: vi.fn(async () => ({
      ...capture,
      capture: { ...capture.capture, status: "analyzed" as const },
      latestAnalysis: {
        id: analysis.id,
        revision: 1,
        createdAt: analysis.createdAt,
        reviewState: "pendingReview" as const,
      },
    })),
    patchCapture: vi.fn(),
    deleteCapture: vi.fn(),
    analyzeCapture: vi.fn(),
    getAnalysisRequestStatus: vi.fn(),
  };
  const review: InboxApi = {
    listPending: vi.fn(async () => ({ items: [], nextCursor: null })),
    getAnalysis: vi.fn(async () => analysis),
    confirmCandidates: vi.fn(),
    processNothingToSave: vi.fn(),
  };
  return { api, review, finish, tasks, analysis };
}
async function render(f: ReturnType<typeof fixture>) {
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () =>
    root?.render(<CollectionWorkspace captureApi={f.api} reviewApi={f.review} />),
  );
  return view;
}
it("keeps the first native disclosure node and focus as a final snapshot adds remaining units", async () => {
  const f = fixture();
  const view = await render(f);
  const summary = view.querySelector<HTMLElement>("[data-structure-modifiers] > summary");
  const disclosure = summary?.parentElement as HTMLDetailsElement | null;
  if (!summary || !disclosure) throw new Error("Expected native first preview.");
  disclosure.open = true;
  summary.focus();
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(1);
  await act(async () => f.finish());
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(2);
  expect(view.querySelector("[data-structure-modifiers] > summary")).toBe(summary);
  expect(document.activeElement).toBe(summary);
  expect(disclosure.open).toBe(true);
  expect(view.querySelectorAll("[data-recommendation]")).toHaveLength(2);
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
it("rejects a foreign terminal task before rendering its completed result and never resubmits", async () => {
  const f = fixture(true);
  const view = await render(f);
  await act(async () => f.finish());
  expect(view.textContent).toContain("收到的结果与当前任务不一致");
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(0);
  expect(view.querySelectorAll("[data-recommendation]")).toHaveLength(0);
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
it("restores an existing task using its original source after the capture kind changes", async () => {
  const f = fixture(false, "sentence");
  const view = await render(f);
  await act(async () => f.finish());
  expect(view.textContent).not.toContain("收到的结果与当前任务不一致");
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(2);
  expect(view.querySelectorAll("[data-recommendation]")).toHaveLength(2);
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
