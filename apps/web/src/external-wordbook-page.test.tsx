import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WordbookJobResource } from "@huayi/cloud-contracts";

import { ExternalWordbookPage } from "./external-wordbook-page.js";
import type { WebExternalWordbookApi } from "./external-wordbook-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pending: WordbookJobResource = {
  createdAt: "2026-08-13T01:00:00.000Z",
  direction: "export",
  failedCount: 0,
  id: "10000000-0000-4000-8000-000000000001",
  lastErrorCode: null,
  nextPage: null,
  processedCount: 0,
  revision: 1,
  state: "pending",
  target: "eudic",
  totalCount: 2,
  updatedAt: "2026-08-13T01:00:00.000Z",
};
const failed: WordbookJobResource = {
  ...pending,
  failedCount: 1,
  id: "10000000-0000-4000-8000-000000000002",
  lastErrorCode: "network-error",
  state: "failed",
  target: "shanbay",
};

function api(overrides: Partial<WebExternalWordbookApi> = {}): WebExternalWordbookApi {
  return {
    cancelJob: vi.fn(async (_id, input) => ({
      ...pending,
      revision: input.expectedRevision + 1,
      state: "cancelled" as const,
    })),
    createJob: vi.fn(async () => pending),
    downloadWords: vi.fn(async () => ({
      blob: new Blob(["accountable\n"]),
      filename: "huayi-words.txt" as const,
    })),
    getJob: vi.fn(async () => pending),
    listJobs: vi.fn(async () => ({ items: [pending, failed], nextCursor: null })),
    retryJob: vi.fn(async (_id, input) => ({
      ...failed,
      failedCount: 0,
      lastErrorCode: null,
      revision: input.expectedRevision + 1,
      state: "pending" as const,
    })),
    ...overrides,
  };
}

async function render(wordbooks: WebExternalWordbookApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(<ExternalWordbookPage api={wordbooks} />));
  await act(async () => Promise.resolve());
  return container;
}

describe("Web external wordbook jobs", () => {
  beforeEach(() => document.body.replaceChildren());

  it("shows aggregate Cloud authority without exposing payload or credentials", async () => {
    const container = await render(api());
    expect(container.querySelector("h1")?.textContent).toBe("外部词典任务");
    expect(container.textContent).toContain("欧路词典 · 导出");
    expect(container.textContent).toContain("扇贝 · 导出");
    expect(container.textContent).toContain("网络暂时不可用");
    expect(container.textContent).not.toContain("leaseToken");
    expect(container.querySelector("[aria-current='page']")?.textContent).toBe("外部词典");
  });

  it("creates one selected task and rereads the server list", async () => {
    const wordbooks = api();
    const container = await render(wordbooks);
    const shanbay = container.querySelector<HTMLInputElement>("[value='shanbay-export']");
    if (shanbay === null) throw new Error("Shanbay option missing.");
    await act(async () => shanbay.click());
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-create-wordbook-job]")?.requestSubmit(),
    );
    expect(wordbooks.createJob).toHaveBeenCalledWith(
      { direction: "export", target: "shanbay" },
      expect.any(String),
    );
    expect(wordbooks.listJobs).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role='status']")?.textContent).toContain("任务已创建");
  });

  it("downloads the interoperability word list without calling it a backup", async () => {
    const wordbooks = api();
    const downloadFile = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <ExternalWordbookPage api={wordbooks} downloadFile={downloadFile} />,
      ),
    );
    await act(async () => Promise.resolve());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-download-word-list]")?.click(),
    );
    expect(wordbooks.downloadWords).toHaveBeenCalledOnce();
    expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), "huayi-words.txt");
    expect(container.textContent).toContain("互操作词表");
    expect(container.textContent).not.toContain("完整备份");
  });

  it("retries failures and requires focused confirmation before cancel", async () => {
    const wordbooks = api();
    const container = await render(wordbooks);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`[data-retry-job='${failed.id}']`)?.click(),
    );
    expect(wordbooks.retryJob).toHaveBeenCalledWith(
      failed.id,
      { expectedRevision: failed.revision },
      expect.any(String),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`[data-cancel-job='${pending.id}']`)?.click(),
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      `[data-confirm-cancel='${pending.id}']`,
    );
    expect(wordbooks.cancelJob).not.toHaveBeenCalled();
    expect(confirm).toBe(document.activeElement);
    await act(async () => confirm?.click());
    expect(wordbooks.cancelJob).toHaveBeenCalledWith(
      pending.id,
      { expectedRevision: pending.revision },
      expect.any(String),
    );
  });

  it("offers retry after load failure and renders an honest empty state", async () => {
    const wordbooks = api({
      listJobs: vi
        .fn<WebExternalWordbookApi["listJobs"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [], nextCursor: null }),
    });
    const container = await render(wordbooks);
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "无法载入外部词典任务",
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-wordbook-jobs]")?.click(),
    );
    expect(container.textContent).toContain("还没有外部词典任务");
  });
});
