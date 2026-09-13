import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accountDataExportJobReadResourceSchema } from "@huayi/cloud-contracts";
import { AccountDataRightsPage, type AccountDataRightsApi } from "./account-data-rights-page.js";
const time = "2026-09-13T00:00:00Z";
const ready = accountDataExportJobReadResourceSchema.parse({
  id: "export",
  formatVersion: 3,
  revision: 2,
  state: "ready",
  createdAt: time,
  updatedAt: time,
  expiresAt: time,
  byteLength: 20,
  recordCount: 2,
});
let root: Root | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function mount(job: typeof ready | null = null) {
  const api: AccountDataRightsApi = {
    createAccountDataExport: vi.fn(async () => ready),
    getCurrentAccountDataExport: vi.fn(async () => ({ job })),
    retryAccountDataExport: vi.fn(async () => ready),
    downloadAccountDataExport: vi.fn(),
    deleteAccount: vi.fn(),
    logout: vi.fn(),
  };
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root?.render(<AccountDataRightsPage api={api} onSessionEnded={vi.fn()} />));
  return { node, api };
}
it("requests format 4 explicitly and preserves format 3 for an existing saved job", async () => {
  const { node, api } = await mount();
  await act(async () => node.querySelector<HTMLButtonElement>("[data-create-export]")?.click());
  expect(api.createAccountDataExport).toHaveBeenCalledWith(4);
  api.downloadAccountDataExport = vi.fn(async () => ({
    url: "https://storage.example.test/file",
    expiresAt: time,
  }));
  vi.stubGlobal("open", vi.fn());
  await act(async () => node.querySelector<HTMLButtonElement>("[data-download-export]")?.click());
  expect(api.downloadAccountDataExport).toHaveBeenCalledWith("export", 3);
});
it("does not open a late sensitive download after leaving the data page", async () => {
  const { node, api } = await mount(ready);
  let finish: (value: { url: string; expiresAt: string }) => void = () => undefined;
  api.downloadAccountDataExport = vi.fn(
    () =>
      new Promise<{ url: string; expiresAt: string }>((resolve) => {
        finish = resolve;
      }),
  );
  const open = vi.fn();
  vi.stubGlobal("open", open);
  await act(async () => node.querySelector<HTMLButtonElement>("[data-download-export]")?.click());
  act(() => root?.unmount());
  root = undefined;
  await act(async () =>
    finish({ url: "https://storage.example.test/old-account", expiresAt: time }),
  );
  expect(open).not.toHaveBeenCalled();
});
it("releases an old busy action when a new API scope loads and ignores the old completion", async () => {
  const { node, api } = await mount();
  let finish: (value: typeof ready) => void = () => undefined;
  api.createAccountDataExport = vi.fn(
    () =>
      new Promise<typeof ready>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => node.querySelector<HTMLButtonElement>("[data-create-export]")?.click());
  const next = { ...api, createAccountDataExport: vi.fn(async () => ready) };
  await act(async () =>
    root?.render(<AccountDataRightsPage api={next} onSessionEnded={vi.fn()} />),
  );
  expect(node.querySelector<HTMLButtonElement>("[data-create-export]")?.disabled).toBe(false);
  await act(async () => finish(ready));
  expect(node.textContent).toContain("尚未请求完整数据导出");
  await act(async () => node.querySelector<HTMLButtonElement>("[data-create-export]")?.click());
  expect(next.createAccountDataExport).toHaveBeenCalledWith(4);
});
