import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, vi } from "vitest";
import {
  analysisRecordSchema,
  confirmCandidatesResponseSchema,
  contractFixtures,
  type LearningTaskSnapshot,
  type LearningTaskPayload,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { StudyInbox } from "./study-inbox.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
export const analysis = analysisRecordSchema.parse({
  ...contractFixtures.analysis,
  studyCaptureId: "capture-1",
});
export const date = "2026-09-05T00:00:00.000Z";
export const detail: StudyCaptureDetailResponse = {
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
export const job: LearningTaskSnapshot = {
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
export async function unmountStudyInbox() {
  await act(async () => root?.unmount());
}
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
export function setup(
  overrides: Partial<WebStudyCaptureApi> = {},
  reviews: Partial<InboxApi> = {},
) {
  const tasks = {
    submit: vi.fn(async () => job),
    list: vi.fn(async (): Promise<LearningTaskSnapshot[]> => []),
    get: vi.fn(async () => job),
    cancel: vi.fn(async () => ({ ...job, state: "cancelled" as const })),
    watch: vi.fn<NonNullable<WebStudyCaptureApi["analysisTasks"]>["watch"]>(
      async function* (): AsyncIterable<LearningTaskPayload> {
        yield {
          type: "analysis.preview" as const,
          requestId: "request-1",
          text: "先理解原文",
          section: "overall" as const,
        };
      },
    ),
  };
  const api: WebStudyCaptureApi = {
    analysisTasks: tasks,
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
export async function render(fixture: ReturnType<typeof setup>) {
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
export async function click(container: Element, selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  await act(async () => {
    button.click();
  });
}
export async function change(container: Element, selector: string, text: string) {
  const field = container.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`Missing ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
