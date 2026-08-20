import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionSessionResource } from "@huayi/cloud-contracts";

import { DeviceSessionsPage, type DeviceSessionsApi } from "./device-sessions-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: ExtensionSessionResource = {
  createdAt: "2026-08-13T00:00:00.000Z",
  deviceLabel: "Writing laptop",
  expiresAt: "2026-11-13T00:00:00.000Z",
  id: "session-1",
  lastUsedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function api(overrides: Partial<DeviceSessionsApi> = {}): DeviceSessionsApi {
  return {
    listExtensionSessions: vi.fn(async () => ({ items: [session] })),
    revokeExtensionSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function render(deviceApi: DeviceSessionsApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(<DeviceSessionsPage api={deviceApi} csrfToken={"c".repeat(32)} />),
  );
  return container;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Web account device sessions", () => {
  beforeEach(() => document.body.replaceChildren());

  it("announces loading and renders an accessible empty state", async () => {
    const pending = deferred<{ items: ExtensionSessionResource[] }>();
    const container = await render(api({ listExtensionSessions: vi.fn(() => pending.promise) }));

    expect(container.querySelector("[role='status']")?.textContent).toContain("正在载入设备");
    await act(async () => pending.resolve({ items: [] }));
    expect(container.querySelector("h2")?.textContent).toContain("没有已连接的扩展设备");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("recovers from a list error and shows server-owned session metadata", async () => {
    const deviceApi = api({
      listExtensionSessions: vi
        .fn<DeviceSessionsApi["listExtensionSessions"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [session] }),
    });
    const container = await render(deviceApi);
    await settle();

    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入设备");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-devices]")?.click(),
    );
    expect(deviceApi.listExtensionSessions).toHaveBeenCalledTimes(2);
    expect(container.querySelector("ul")?.textContent).toContain("Writing laptop");
    expect(container.textContent).toContain("尚未使用");
    expect(container.textContent).toContain("只删除本机凭据，不等同于服务器撤销");
  });

  it("requires confirmation, revokes on the server, and announces success", async () => {
    const deviceApi = api();
    const container = await render(deviceApi);
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-request-revoke='session-1']")?.click(),
    );
    const confirm = container.querySelector<HTMLButtonElement>("[data-confirm-revoke]");
    expect(confirm).toBe(document.activeElement);
    expect(container.textContent).toContain("这会立即撤销服务器上的云端授权");
    await act(async () => confirm?.click());

    expect(deviceApi.revokeExtensionSession).toHaveBeenCalledWith("session-1", "c".repeat(32));
    expect(container.querySelector("[role='status']")?.textContent).toContain(
      "已撤销 Writing laptop 的服务器会话",
    );
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("h2")).toBe(document.activeElement);
  });

  it("keeps the device retryable when server revocation fails", async () => {
    const deviceApi = api({
      revokeExtensionSession: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const container = await render(deviceApi);
    await settle();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-request-revoke='session-1']")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-revoke]")?.click(),
    );

    expect(container.querySelector("[role='alert']")?.textContent).toContain("服务器撤销失败");
    expect(container.querySelector("ul")?.textContent).toContain("Writing laptop");
  });
});
