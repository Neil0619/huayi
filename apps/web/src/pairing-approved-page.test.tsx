import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudApp, type IdentityApi } from "./cloud-app.js";
import { WebIdentityApiError } from "./identity-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function identityApi(overrides: Partial<IdentityApi> = {}): IdentityApi {
  return {
    approvePairing: vi.fn(async () => undefined),
    bootstrap: vi.fn(async () => ({ access: "full" as const, csrfToken: "c".repeat(32) })),
    createAccountDataExport: vi.fn(),
    deleteAccount: vi.fn(),
    downloadAccountDataExport: vi.fn(),
    getCurrentAccountDataExport: vi.fn(),
    getAccount: vi.fn(),
    getAccountPreferences: vi.fn(async () => ({
      cloudWordCopyMode: "enabled" as const,
      dailyGoal: 3,
      extensionQueryModelMode: "platform" as const,
      revision: 1,
      studyCaptureMode: "manual" as const,
      timezone: "UTC",
      updatedAt: "2026-09-10T10:00:00.000Z",
    })),
    getPairing: vi.fn(async () => ({
      expiresAt: "2026-09-10T12:00:00.000Z",
      id: "pairing-1",
      pairingPath: "/pair-extension/pairing-1",
      status: "approved" as const,
    })),
    listExtensionSessions: vi.fn(),
    logout: vi.fn(),
    reauthenticatePassword: vi.fn(),
    retryAccountDataExport: vi.fn(),
    revokeExtensionSession: vi.fn(),
    ...overrides,
  };
}

function pendingIdentity(overrides: Partial<IdentityApi> = {}) {
  return identityApi({
    getPairing: vi.fn(async () => ({
      expiresAt: "2026-09-10T12:00:00.000Z",
      id: "pairing-1",
      pairingPath: "/pair-extension/pairing-1",
      status: "pending" as const,
    })),
    ...overrides,
  });
}

describe("approved pairing countdown", () => {
  let root: Root;
  let container: HTMLDivElement;
  const assign = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    assign.mockReset();
    vi.stubGlobal("location", { assign });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(identity = identityApi()) {
    await act(async () =>
      root.render(
        <StrictMode>
          <CloudApp identity={identity} pairingId="pairing-1" />
        </StrictMode>,
      ),
    );
  }

  async function advance(milliseconds: number) {
    await act(async () => vi.advanceTimersByTime(milliseconds));
  }

  function expectCountdown(seconds: number) {
    expect(container.querySelector("[role='status']")?.textContent).toContain(
      `${seconds} 秒后自动进入学习平台`,
    );
  }

  async function approve() {
    const consent = container.querySelector<HTMLInputElement>("[name='cloudUploadConsent']");
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']");
    if (!consent || !submit) throw new Error("Pairing approval controls are missing.");
    expect(submit.disabled).toBe(true);
    await act(async () => consent.click());
    await act(async () => submit.click());
  }

  it("shows 3, 2, 1 for one second each then enters same-origin practice once in StrictMode", async () => {
    await render();
    expectCountdown(3);
    const link = container.querySelector<HTMLAnchorElement>("a.primary-button");
    expect(link?.textContent).toBe("立即进入学习平台");
    expect(link?.pathname).toBe("/practice");
    expect(link?.origin).toBe(new URL(document.URL).origin);
    await advance(999);
    expectCountdown(3);
    expect(assign).not.toHaveBeenCalled();
    await advance(1);
    expectCountdown(2);
    await advance(999);
    expectCountdown(2);
    expect(assign).not.toHaveBeenCalled();
    await advance(1);
    expectCountdown(1);
    await advance(999);
    expectCountdown(1);
    expect(assign).not.toHaveBeenCalled();
    await advance(1);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/practice");
    expect(new URL(assign.mock.calls[0]?.[0] as string, document.URL).origin).toBe(
      new URL(document.URL).origin,
    );
    await advance(10_000);
    expect(assign).toHaveBeenCalledOnce();
  });

  it("waits for the approval response before starting the full three seconds", async () => {
    let confirm: (() => void) | undefined;
    const identity = pendingIdentity({
      approvePairing: vi.fn(() => new Promise<void>((resolve) => (confirm = resolve))),
    });
    await render(identity);
    await advance(5000);
    expect(assign).not.toHaveBeenCalled();
    await approve();
    await advance(5000);
    expect(container.querySelector("h1")?.textContent).toBe("连接语见插件");
    expect(assign).not.toHaveBeenCalled();
    await act(async () => confirm?.());
    expectCountdown(3);
    await advance(2999);
    expect(assign).not.toHaveBeenCalled();
    await advance(1);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/practice");
    expect(identity.approvePairing).toHaveBeenCalledOnce();
  });

  it("cancels countdown and navigation when unmounted", async () => {
    await render();
    await advance(1000);
    expectCountdown(2);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not redirect a failed approval", async () => {
    await render(
      pendingIdentity({ approvePairing: vi.fn().mockRejectedValue(new Error("offline")) }),
    );
    await approve();
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法继续这次配对");
    await advance(5000);
    expect(assign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["authentication_required", "unknown"] as const)(
    "does not redirect when bootstrap fails with %s",
    async (code) => {
      await render(
        identityApi({ bootstrap: vi.fn().mockRejectedValue(new WebIdentityApiError(code, 401)) }),
      );
      expect(container.querySelector("h1")?.textContent).toBe(
        code === "authentication_required" ? "需要先登录" : "无法继续配对",
      );
      await advance(5000);
      expect(assign).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
