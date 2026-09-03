import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analysisRecordSchema, contractFixtures, type AnalysisEvent } from "@huayi/cloud-contracts";

import { PasteAnalysisPage, type PasteAnalysisApi } from "./paste-analysis-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analysis = analysisRecordSchema.parse(contractFixtures.analysis);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function api(startAnalysis: PasteAnalysisApi["startAnalysis"]): PasteAnalysisApi {
  return {
    getRequestStatus: vi.fn(async () => ({
      analysisId: analysis.id,
      requestId: "request-1",
      state: "completed" as const,
    })),
    startAnalysis,
  };
}

async function render(analysisApi: PasteAnalysisApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <PasteAnalysisPage api={analysisApi} createIdempotencyKey={() => "analysis-key"} />,
    ),
  );
  return container;
}

async function change(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function control<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  container: Element,
  name: string,
): T {
  const value = container.querySelector<T>(`[name='${name}']`);
  if (value === null) throw new Error(`Missing control ${name}.`);
  return value;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Web pasted-English analysis", () => {
  beforeEach(() => document.body.replaceChildren());

  it("submits only strict manual input and progressively hands completion to Inbox", async () => {
    const startAnalysis = vi.fn<PasteAnalysisApi["startAnalysis"]>(async function* () {
      yield { requestId: "request-1", type: "analysis.started", unitCount: 1 };
      yield {
        requestId: "request-1",
        section: "overall",
        text: "正在理解整体语气…",
        type: "analysis.preview",
      };
      yield { analysis, quota: contractFixtures.quota, type: "analysis.completed" };
      yield {
        requestId: "request-1",
        section: "overall",
        text: "终态后的无效预览",
        type: "analysis.preview",
      };
    });
    const container = await render(api(startAnalysis));
    const sourceText = control<HTMLTextAreaElement>(container, "sourceText");
    const title = control<HTMLInputElement>(container, "sourceTitle");
    await change(sourceText, "To be frank, this works.");
    await change(title, "Writing notes");
    await change(control(container, "selectionKind"), "passage");

    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();

    expect(startAnalysis).toHaveBeenCalledWith(
      {
        selectionKind: "passage",
        source: { title: "Writing notes", type: "manual" },
        sourceText: "To be frank, this works.",
      },
      "analysis-key",
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("正在理解整体语气");
    expect(container.querySelector("[role='status']")?.textContent).toContain("分析已完成");
    expect(container.textContent).not.toContain("终态后的无效预览");
    expect(container.querySelector<HTMLAnchorElement>("[data-open-inbox]")?.pathname).toBe("/app");
    expect(sourceText.value).toBe("To be frank, this works.");
  });

  it("retains input after a strict failed event and retries with a fresh key", async () => {
    let attempt = 0;
    const startAnalysis = vi.fn<PasteAnalysisApi["startAnalysis"]>(async function* () {
      attempt += 1;
      if (attempt === 1) {
        yield {
          error: {
            code: "model_unavailable",
            message: "The model is temporarily unavailable.",
            requestId: "request-1",
          },
          quota: contractFixtures.quota,
          type: "analysis.failed",
        };
        return;
      }
      yield { analysis, quota: contractFixtures.quota, type: "analysis.completed" };
    });
    let key = 0;
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <PasteAnalysisPage api={api(startAnalysis)} createIdempotencyKey={() => `key-${++key}`} />,
      ),
    );
    const sourceText = control<HTMLTextAreaElement>(container, "sourceText");
    await change(sourceText, "Retry this sentence.");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "模型服务尚未开放或暂时不可用",
    );
    expect(sourceText.value).toBe("Retry this sentence.");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-analysis]")?.click(),
    );
    await settle();

    expect(startAnalysis.mock.calls.map((call) => call[1])).toEqual(["key-1", "key-2"]);
    expect(container.querySelector("[role='status']")?.textContent).toContain("分析已完成");
  });

  it("cancels the active stream and suppresses every late event", async () => {
    const release = deferred<undefined>();
    const startAnalysis = vi.fn<PasteAnalysisApi["startAnalysis"]>(async function* () {
      yield { requestId: "request-1", type: "analysis.started", unitCount: 1 };
      await release.promise;
      yield {
        requestId: "request-1",
        section: "overall",
        text: "迟到的预览",
        type: "analysis.preview",
      };
      yield { analysis, quota: contractFixtures.quota, type: "analysis.completed" };
    });
    const container = await render(api(startAnalysis));
    await change(control(container, "sourceText"), "Cancel this sentence.");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-cancel-analysis]")?.click(),
    );
    expect(startAnalysis.mock.calls[0]?.[2]?.aborted).toBe(true);
    expect(container.querySelector("[data-check-analysis-status]")).not.toBeNull();
    await act(async () => release.resolve(undefined));
    await settle();

    expect(container.querySelector("[role='status']")?.textContent).toContain("已取消");
    expect(container.textContent).not.toContain("迟到的预览");
    expect(container.querySelector("[data-open-inbox]")).toBeNull();
  });

  it("re-enables analysis after cancellation without requiring an input edit", async () => {
    const release = deferred<undefined>();
    const startAnalysis = vi.fn<PasteAnalysisApi["startAnalysis"]>(async function* () {
      yield { requestId: "request-1", type: "analysis.started", unitCount: 1 };
      await release.promise;
      yield { analysis, quota: contractFixtures.quota, type: "analysis.completed" };
    });
    const container = await render(api(startAnalysis));
    await change(control(container, "sourceText"), "Cancel and retry this sentence.");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-cancel-analysis]")?.click(),
    );
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(container.querySelector("[role='status']")?.textContent).toContain("已取消");
    expect(submit?.disabled).toBe(false);
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();
    expect(startAnalysis).toHaveBeenCalledTimes(2);
    await act(async () => release.resolve(undefined));
    await settle();
    expect(container.querySelector("[role='status']")?.textContent).toContain("分析已完成");
  });

  it("uses the authenticated request status when a started stream ends without a terminal event", async () => {
    const analysisApi = api(async function* () {
      yield { requestId: "request-1", type: "analysis.started", unitCount: 1 };
    });
    const container = await render(analysisApi);
    await change(control(container, "sourceText"), "Recover this request.");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();

    expect(analysisApi.getRequestStatus).toHaveBeenCalledWith("request-1");
    expect(container.querySelector("[role='status']")?.textContent).toContain("分析已完成");
    expect(container.querySelector("[data-open-inbox]")).not.toBeNull();
  });

  it("does not fake completion or start a duplicate while request status is still running", async () => {
    const analysisApi = api(async function* () {
      yield { requestId: "request-1", type: "analysis.started", unitCount: 1 };
    });
    analysisApi.getRequestStatus = vi
      .fn<PasteAnalysisApi["getRequestStatus"]>()
      .mockResolvedValueOnce({ requestId: "request-1", state: "running" as const })
      .mockResolvedValueOnce({ requestId: "request-1", state: "running" as const })
      .mockResolvedValueOnce({
        analysisId: "analysis-1",
        requestId: "request-1",
        state: "completed" as const,
      });
    const container = await render(analysisApi);
    await change(control(container, "sourceText"), "Keep processing this request.");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();

    expect(container.querySelector("[role='status']")?.textContent).toContain("服务器仍在处理");
    expect(container.querySelector("[data-open-inbox]")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(
      true,
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-check-analysis-status]")?.click(),
    );
    await settle();
    expect(analysisApi.getRequestStatus).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role='status']")?.textContent).toContain(
      "已重新检查，服务器仍在处理",
    );
    expect(container.querySelector("[data-open-inbox]")).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-check-analysis-status]")?.click(),
    );
    await settle();
    expect(analysisApi.getRequestStatus).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-open-inbox]")).not.toBeNull();
  });

  it("exposes native max bounds and no client-owned authority fields", async () => {
    const startAnalysis = vi.fn<PasteAnalysisApi["startAnalysis"]>(
      async function* (): AsyncIterable<AnalysisEvent> {
        yield { analysis, quota: contractFixtures.quota, type: "analysis.completed" };
      },
    );
    const container = await render(api(startAnalysis));
    expect(control<HTMLTextAreaElement>(container, "sourceText").maxLength).toBe(2_000);
    expect(control<HTMLInputElement>(container, "sourceTitle").maxLength).toBe(500);
    expect(
      container.querySelector("[name='userId'], [name='model'], [name='provider']"),
    ).toBeNull();
    expect(container.textContent).toContain("手动粘贴");
    await change(control(container, "sourceText"), "No title is needed.");
    await change(control(container, "sourceTitle"), "   ");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await settle();
    expect(startAnalysis.mock.calls[0]?.[0].source).toEqual({ type: "manual" });
  });
});
