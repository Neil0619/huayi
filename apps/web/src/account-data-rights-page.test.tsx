import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountDataExportJobResourceSchema } from "@huayi/cloud-contracts";

import { AccountDataRightsPage, type AccountDataRightsApi } from "./account-data-rights-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pending = accountDataExportJobResourceSchema.parse({
  createdAt: "2026-08-13T01:00:00.000Z",
  formatVersion: 1,
  id: "export-1",
  revision: 1,
  state: "pending",
  updatedAt: "2026-08-13T01:00:00.000Z",
});

function api(overrides: Partial<AccountDataRightsApi> = {}): AccountDataRightsApi {
  return {
    createAccountDataExport: vi.fn(async () => pending),
    deleteAccount: vi.fn(async () => ({
      accepted: true as const,
      requestedAt: "2026-08-13T01:00:00.000Z",
    })),
    downloadAccountDataExport: vi.fn(),
    getCurrentAccountDataExport: vi.fn(async () => ({ job: null })),
    retryAccountDataExport: vi.fn(async () => pending),
    ...overrides,
  };
}

async function render(rightsApi: AccountDataRightsApi, onAccountDeleted = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <AccountDataRightsPage api={rightsApi} onAccountDeleted={onAccountDeleted} />,
    ),
  );
  await act(async () => Promise.resolve());
  return container;
}

describe("Web account data rights", () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => vi.unstubAllGlobals());

  it("loads an honest empty state and creates one export", async () => {
    const rightsApi = api();
    const container = await render(rightsApi);
    expect(container.querySelector("h1")?.textContent).toBe("导出与永久删除");
    expect(container.textContent).toContain("尚未请求完整数据导出");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-create-export]")?.click(),
    );
    expect(rightsApi.createAccountDataExport).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("正在等待生成");
  });

  it("downloads only after a ready response and does not persist the signed URL", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const ready = accountDataExportJobResourceSchema.parse({
      byteLength: 512,
      createdAt: "2026-08-13T01:00:00.000Z",
      expiresAt: "2026-08-14T01:00:00.000Z",
      formatVersion: 1,
      id: "export-1",
      recordCount: 4,
      revision: 2,
      state: "ready",
      updatedAt: "2026-08-13T01:02:00.000Z",
    });
    const rightsApi = api({
      downloadAccountDataExport: vi.fn(async () => ({
        expiresAt: "2026-08-13T01:17:00.000Z",
        url: "https://project.supabase.co/storage/v1/object/sign/private/export?token=opaque",
      })),
      getCurrentAccountDataExport: vi.fn(async () => ({ job: ready })),
    });
    const container = await render(rightsApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-download-export]")?.click(),
    );
    expect(open).toHaveBeenCalledWith(
      "https://project.supabase.co/storage/v1/object/sign/private/export?token=opaque",
      "_blank",
      "noopener,noreferrer",
    );
    expect(container.textContent).not.toContain("token=opaque");
  });

  it("requires checkbox, exact local phrase, and a second confirmation before deletion", async () => {
    const rightsApi = api();
    const onAccountDeleted = vi.fn();
    const container = await render(rightsApi, onAccountDeleted);
    const checkbox = container.querySelector<HTMLInputElement>("[name='understood']");
    const phrase = container.querySelector<HTMLInputElement>("[name='confirmationPhrase']");
    const prepare = container.querySelector<HTMLButtonElement>("[data-prepare-deletion]");
    if (checkbox === null || phrase === null || prepare === null)
      throw new Error("Controls missing.");
    expect(prepare.disabled).toBe(true);
    await act(async () => checkbox.click());
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(phrase, "删除我的账号");
      phrase.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(prepare.disabled).toBe(false);
    await act(async () => prepare.click());
    expect(rightsApi.deleteAccount).not.toHaveBeenCalled();
    const confirm = container.querySelector<HTMLButtonElement>("[data-confirm-deletion]");
    expect(confirm).toBe(document.activeElement);
    await act(async () => confirm?.click());
    expect(rightsApi.deleteAccount).toHaveBeenCalledOnce();
    expect(onAccountDeleted).toHaveBeenCalledOnce();
    expect(container.querySelector("[role='status']")?.textContent).toContain("删除请求已接受");
  });
});
