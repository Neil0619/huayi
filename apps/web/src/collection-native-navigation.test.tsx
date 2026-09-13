import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";
import { CollectionWorkspace } from "./collection-workspace.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
it("removes native units when switching a standalone manual analysis to a legacy record", async () => {
  const native = nativeWebAnalysis();
  const legacy = analysisRecordSchema.parse(contractFixtures.analysis);
  const captureApi: WebStudyCaptureApi = {
    listCaptures: vi.fn(async () => ({ items: [], nextCursor: null })),
    getCapture: vi.fn(),
    patchCapture: vi.fn(),
    deleteCapture: vi.fn(),
    analyzeCapture: vi.fn(),
    getAnalysisRequestStatus: vi.fn(),
  };
  const reviewApi: InboxApi = {
    listPending: vi.fn(async () => ({ items: [native, legacy], nextCursor: null })),
    getAnalysis: vi.fn(),
    confirmCandidates: vi.fn(),
    processNothingToSave: vi.fn(),
  };
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () =>
    root?.render(<CollectionWorkspace captureApi={captureApi} reviewApi={reviewApi} />),
  );
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(2);
  await act(async () => view.querySelectorAll<HTMLButtonElement>("aside button")[1]?.click());
  expect(view.querySelector(".analysis-detail h2")?.textContent).toBe(legacy.sourceText);
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(0);
  expect(view.querySelectorAll(".collection-candidate")).toHaveLength(legacy.candidates.length);
  await act(async () => view.querySelectorAll<HTMLButtonElement>("aside button")[0]?.click());
  expect(view.querySelectorAll("[data-native-unit]")).toHaveLength(2);
});
