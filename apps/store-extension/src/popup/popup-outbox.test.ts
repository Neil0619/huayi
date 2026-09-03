import { readFileSync } from "node:fs";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, expect, it, vi } from "vitest";

import { PopupPage } from "./popup-page.js";

const popupHtml = readFileSync("apps/store-extension/pages/popup.html", "utf8");
const popupCss = readFileSync("apps/store-extension/pages/popup.css", "utf8");

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing popup element: ${selector}`);
  return found;
}

function cloud() {
  return {
    expiresAt: "2026-09-13T00:00:00.000Z",
    messageVersion: STORE_MESSAGE_VERSION,
    status: "connected" as const,
    type: "store/cloud-session-result" as const,
  };
}

function popupStatus() {
  return {
    appearance: "silver" as const,
    globallyEnabled: true,
    messageVersion: STORE_MESSAGE_VERSION,
    modelConsentGranted: true,
    overlayTheme: "pearl" as const,
    providerId: "deepseek" as const,
    type: "store/popup-status-result" as const,
  };
}

function queued(outcome = "status") {
  return {
    count: 2,
    messageVersion: STORE_MESSAGE_VERSION,
    oldestQueuedAt: "2026-08-13T00:00:00.000Z",
    outcome,
    state: "queued",
    type: "store/submission-outbox-result",
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

it("shows sanitized queued metadata, retries, and requires two-step local clear", async () => {
  document.documentElement.innerHTML = popupHtml;
  const sendRuntimeMessage = vi.fn(async (message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === "store/popup-status") return popupStatus();
    if (type === "store/cloud-session-status") return cloud();
    if (type === "store/submission-outbox-status") return queued();
    if (type === "store/submission-outbox-retry") return queued("retry-pending");
    if (type === "store/submission-outbox-clear") {
      return {
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "cleared",
        state: "empty",
        type: "store/submission-outbox-result",
      };
    }
    throw new Error("Unexpected runtime message.");
  });
  const page = new PopupPage({
    openOptionsPage: vi.fn(),
    queryActiveTab: vi.fn(async () => null),
    sendRuntimeMessage,
    sendTabMessage: vi.fn(),
  });
  await page.initialize();

  expect(element("[data-submission-outbox-state]").textContent).toContain("2 条学习采集等待提交");
  expect(element<HTMLElement>(".outbox-actions").hidden).toBe(false);
  expect(document.body.textContent).not.toContain("sourceText");
  element<HTMLButtonElement>("[data-submission-outbox-retry]").click();
  await vi.waitFor(() => expect(element("[data-popup-status]").textContent).toContain("自动重试"));
  expect(sendRuntimeMessage).toHaveBeenCalledWith({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/submission-outbox-retry",
  });

  const clear = element<HTMLButtonElement>("[data-submission-outbox-clear]");
  clear.click();
  expect(clear.textContent).toBe("确认清空");
  expect(sendRuntimeMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "store/submission-outbox-clear" }),
  );
  clear.click();
  await vi.waitFor(() =>
    expect(element("[data-submission-outbox-state]").textContent).toBe("没有待提交学习采集"),
  );
  expect(element<HTMLElement>(".outbox-actions").hidden).toBe(true);
  expect(sendRuntimeMessage).toHaveBeenCalledWith({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/submission-outbox-clear",
  });
  expect(document.activeElement).toBe(element("[data-submission-outbox-state]"));
});

it("renders fail-closed states without enabling queue actions", async () => {
  for (const state of ["not-configured", "upload-disabled", "session-unavailable"] as const) {
    document.documentElement.innerHTML = popupHtml;
    const page = new PopupPage({
      openOptionsPage: vi.fn(),
      queryActiveTab: vi.fn(async () => null),
      sendRuntimeMessage: vi.fn(async (message: unknown) => {
        const type = (message as { type?: string }).type;
        if (type === "store/popup-status") return popupStatus();
        if (type === "store/cloud-session-status") return cloud();
        return {
          messageVersion: STORE_MESSAGE_VERSION,
          outcome: "status",
          state,
          type: "store/submission-outbox-result",
        };
      }),
      sendTabMessage: vi.fn(),
    });
    await page.initialize();
    expect(element<HTMLButtonElement>("[data-submission-outbox-retry]").disabled).toBe(true);
    expect(element<HTMLButtonElement>("[data-submission-outbox-clear]").disabled).toBe(true);
    expect(element<HTMLElement>(".outbox-actions").hidden).toBe(true);
  }
});

it("shows an adapter-missing queue as encrypted locally with clear but no retry", async () => {
  document.documentElement.innerHTML = popupHtml;
  const sendRuntimeMessage = vi.fn(async (message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === "store/popup-status") return popupStatus();
    if (type === "store/cloud-session-status") return cloud();
    if (type === "store/submission-outbox-clear") {
      return {
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "cleared",
        state: "empty",
        type: "store/submission-outbox-result",
      };
    }
    return {
      count: 2,
      messageVersion: STORE_MESSAGE_VERSION,
      oldestQueuedAt: "2026-08-13T00:00:00.000Z",
      outcome: "status",
      state: "not-configured",
      type: "store/submission-outbox-result",
    };
  });
  const page = new PopupPage({
    openOptionsPage: vi.fn(),
    queryActiveTab: vi.fn(async () => null),
    sendRuntimeMessage,
    sendTabMessage: vi.fn(),
  });
  await page.initialize();

  expect(element("[data-submission-outbox-state]").textContent).toContain("2 条");
  expect(element("[data-submission-outbox-state]").textContent).toContain("加密保存在本机");
  expect(element<HTMLButtonElement>("[data-submission-outbox-retry]").disabled).toBe(true);
  expect(element<HTMLButtonElement>("[data-submission-outbox-clear]").disabled).toBe(false);
  expect(element<HTMLElement>(".outbox-actions").hidden).toBe(false);
  expect(document.body.textContent).not.toContain("sourceText");

  const clear = element<HTMLButtonElement>("[data-submission-outbox-clear]");
  clear.click();
  expect(clear.textContent).toBe("确认清空");
  clear.click();
  await vi.waitFor(() => expect(clear.disabled).toBe(true));
  expect(sendRuntimeMessage).toHaveBeenCalledWith({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/submission-outbox-clear",
  });
});

it("announces an upgrade block while preserving only the local clear action", async () => {
  document.documentElement.innerHTML = popupHtml;
  const page = new PopupPage({
    openOptionsPage: vi.fn(),
    queryActiveTab: vi.fn(async () => null),
    sendRuntimeMessage: vi.fn(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "store/popup-status") return popupStatus();
      if (type === "store/cloud-session-status") return cloud();
      return {
        count: 2,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "client-upgrade-required",
        state: "client-upgrade-required",
        type: "store/submission-outbox-result",
      };
    }),
    sendTabMessage: vi.fn(),
  });
  await page.initialize();

  expect(element("[data-submission-outbox-state]").textContent).toContain("更新语见");
  expect(element("[data-submission-outbox-state]").textContent).toContain("加密保存在本机");
  expect(element<HTMLButtonElement>("[data-submission-outbox-retry]").disabled).toBe(true);
  expect(element<HTMLButtonElement>("[data-submission-outbox-clear]").disabled).toBe(false);
  expect(element<HTMLElement>(".outbox-actions").hidden).toBe(false);
  expect(document.body.textContent).not.toContain("1.0.0");
  expect(document.body.textContent).not.toContain("sourceText");
  expect(element("[data-submission-outbox-state]").getAttribute("aria-live")).toBe("polite");
  expect(popupCss).toContain("width: 380px;");
  expect(popupCss).not.toContain("@media (max-width: 359px)");
  expect(popupCss).toContain("@media (prefers-reduced-motion: reduce)");
  expect(popupCss).toContain('strong[data-state="client-upgrade-required"]');
});

it("rereads the SW aggregate after local disconnect clears account-bound submissions", async () => {
  document.documentElement.innerHTML = popupHtml;
  let disconnected = false;
  const sendRuntimeMessage = vi.fn(async (message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === "store/popup-status") return popupStatus();
    if (type === "store/cloud-session-status") return cloud();
    if (type === "store/cloud-session-disconnect") {
      disconnected = true;
      return {
        messageVersion: STORE_MESSAGE_VERSION,
        status: "disconnected",
        type: "store/cloud-session-result",
      };
    }
    if (type === "store/submission-outbox-status") {
      return disconnected
        ? {
            messageVersion: STORE_MESSAGE_VERSION,
            outcome: "status",
            state: "empty",
            type: "store/submission-outbox-result",
          }
        : queued();
    }
    throw new Error("Unexpected runtime message.");
  });
  const page = new PopupPage({
    openOptionsPage: vi.fn(),
    queryActiveTab: vi.fn(async () => null),
    sendRuntimeMessage,
    sendTabMessage: vi.fn(),
  });
  await page.initialize();
  element<HTMLButtonElement>("[data-cloud-session-action]").click();
  await vi.waitFor(() =>
    expect(element("[data-submission-outbox-state]").textContent).toBe("没有待提交学习采集"),
  );
  expect(sendRuntimeMessage).toHaveBeenLastCalledWith({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/submission-outbox-status",
  });
});
