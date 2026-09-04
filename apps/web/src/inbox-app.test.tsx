import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  analysisRecordSchema,
  confirmCandidatesResponseSchema,
  contractFixtures,
  type AnalysisRecord,
} from "@huayi/cloud-contracts";

import { InboxApp, type InboxApi } from "./inbox-app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analysisFixture = analysisRecordSchema.parse(contractFixtures.analysis);
const confirmationFixture = confirmCandidatesResponseSchema.parse(
  contractFixtures.confirmCandidatesResponse,
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function createApi(overrides: Partial<InboxApi> = {}): InboxApi {
  return {
    confirmCandidates: vi.fn(async () => confirmationFixture),
    getAnalysis: vi.fn(async () => analysisFixture),
    listPending: vi.fn(async () => ({ items: [analysisFixture], nextCursor: null })),
    processNothingToSave: vi.fn(async () => ({
      ...analysisFixture,
      reviewState: "reviewed" as const,
      revision: 2,
    })),
    ...overrides,
  };
}

async function render(api: InboxApi) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () =>
    root.render(<InboxApp api={api} createIdempotencyKey={() => "test-key"} />),
  );
  return { container, root };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function input(container: Element, label: string): HTMLInputElement | HTMLTextAreaElement {
  const control = [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ].find((candidate) => candidate.labels?.[0]?.textContent?.trim() === label);
  if (control === undefined) throw new Error(`Missing field: ${label}`);
  return control;
}

async function change(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Web pending-review workspace", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("announces loading, empty, and recoverable list errors", async () => {
    const pending = deferred<{ items: AnalysisRecord[]; nextCursor: string | null }>();
    const api = createApi({ listPending: vi.fn(() => pending.promise) });
    const { container } = await render(api);

    expect(container.querySelector("[role='status']")?.textContent).toContain("正在载入待整理内容");
    await act(async () => pending.resolve({ items: [], nextCursor: null }));
    expect(container.textContent).toContain("待整理箱已经清空");

    const retryApi = createApi({
      listPending: vi
        .fn<InboxApi["listPending"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [], nextCursor: null }),
    });
    const retryView = await render(retryApi);
    await settle();
    expect(retryView.container.querySelector("[role='alert']")?.textContent).toContain(
      "暂时无法载入",
    );
    const retry = retryView.container.querySelector<HTMLButtonElement>("[data-retry-inbox]");
    await act(async () => retry?.click());
    expect(retryApi.listPending).toHaveBeenCalledTimes(2);
    expect(retryView.container.textContent).toContain("待整理箱已经清空");
  });

  it("loads detail, edits and selects candidates, then confirms one atomic batch", async () => {
    const api = createApi();
    const { container } = await render(api);
    await settle();

    expect(api.getAnalysis).toHaveBeenCalledWith("analysis-1");
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
    const text = input(container, "表达");
    await change(text, "to speak frankly");
    await change(input(container, "标签（逗号分隔）"), "writing, conversation");

    const form = container.querySelector<HTMLFormElement>("[data-candidate-form]");
    await act(async () => form?.requestSubmit());

    expect(api.confirmCandidates).toHaveBeenCalledWith(
      "analysis-1",
      {
        analysisRevision: 1,
        confirmations: [
          expect.objectContaining({
            candidateId: "candidate-1",
            decision: "create",
            payload: expect.objectContaining({ text: "to speak frankly" }),
            tags: ["writing", "conversation"],
            targetType: "expression",
          }),
        ],
      },
      "test-key",
    );
    expect(container.querySelector("[role='status']")?.textContent).toContain("已整理 1 项");
    expect(container.textContent).toContain("待整理箱已经清空");
  });

  it("preserves edits and selection when exact duplicate requires a later explicit merge", async () => {
    const exactDuplicate = Object.assign(new Error("duplicate"), { code: "exact_duplicate" });
    const api = createApi({ confirmCandidates: vi.fn(async () => Promise.reject(exactDuplicate)) });
    const { container } = await render(api);
    await settle();
    await change(input(container, "表达"), "to speak frankly");

    const form = container.querySelector<HTMLFormElement>("[data-candidate-form]");
    await act(async () => form?.requestSubmit());

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "学习库中已有相同内容",
    );
    expect(container.querySelector("[role='alert']")?.textContent).toContain("当前编辑已保留");
    expect(input(container, "表达").value).toBe("to speak frankly");
    expect(container.querySelector<HTMLInputElement>("[data-candidate-selected]")?.checked).toBe(
      true,
    );
  });

  it("supports keyboard focus handoff after marking an analysis as unnecessary", async () => {
    const second = {
      ...analysisFixture,
      id: "analysis-2",
      sourceText: "Second analysis.",
    };
    const api = createApi({
      getAnalysis: vi.fn(async (id) => (id === "analysis-2" ? second : analysisFixture)),
      listPending: vi.fn(async () => ({
        items: [analysisFixture, second],
        nextCursor: null,
      })),
    });
    const { container } = await render(api);
    await settle();

    const skip = container.querySelector<HTMLButtonElement>("[data-nothing-to-save]");
    await act(async () => skip?.click());

    expect(api.processNothingToSave).toHaveBeenCalledWith("analysis-1", 1, "test-key");
    expect(container.querySelector<HTMLElement>("[data-analysis-list-heading]")).toBe(
      document.activeElement,
    );
    expect(container.textContent).toContain("Second analysis.");
  });
});
