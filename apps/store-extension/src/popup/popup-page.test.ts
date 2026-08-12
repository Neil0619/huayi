import { readFileSync } from "node:fs";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupPage } from "./popup-page.js";

const popupHtml = readFileSync("apps/store-extension/pages/popup.html", "utf8");

function renderPage(): void {
  document.documentElement.innerHTML = popupHtml;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing popup element: ${selector}`);
  return found;
}

function status() {
  return {
    globallyEnabled: true,
    messageVersion: STORE_MESSAGE_VERSION,
    modelConsentGranted: true,
    overlayTheme: "pearl" as const,
    providerId: "deepseek" as const,
    type: "store/popup-status-result" as const,
  };
}

function site(enabled: boolean) {
  return {
    defaultAction: "ask" as const,
    enabled,
    globallyEnabled: true,
    host: "example.com",
    messageVersion: STORE_MESSAGE_VERSION,
    overlayTheme: "pearl" as const,
    type: "store/site-policy-result" as const,
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

describe("Store PopupPage", () => {
  it("uses one compact operational surface and toggles the current site through content", async () => {
    renderPage();
    const queryActiveTab = vi.fn(async () => ({ id: 7 }));
    const sendTabMessage = vi
      .fn()
      .mockResolvedValueOnce(site(true))
      .mockResolvedValueOnce(site(false));
    const page = new PopupPage({
      openOptionsPage: vi.fn(async () => undefined),
      queryActiveTab,
      sendRuntimeMessage: vi.fn(async () => status()),
      sendTabMessage,
    });
    await page.initialize();

    expect(element("[data-provider]").textContent).toBe("DeepSeek");
    expect(element("[data-model-consent]").textContent).toBe("已允许联网");
    expect(document.querySelector("[data-credential]")).toBeNull();
    expect(document.body.textContent).not.toContain("secret");
    expect(element<HTMLButtonElement>("[data-open-options]").getAttribute("aria-label")).toBe(
      "打开设置",
    );
    expect(
      element<HTMLButtonElement>("[data-toggle-overlay-theme]").getAttribute("aria-label"),
    ).toBe("切换词卡皮肤");
    expect(element<HTMLInputElement>("[data-global-enabled]").checked).toBe(true);
    expect(document.querySelector(".global-control")).toBeNull();
    expect(document.querySelector("[data-analysis-card]")).toBeNull();
    expect(element("[data-analysis-summary]").textContent?.replace(/\s+/gu, " ").trim()).toBe(
      "DeepSeek · 已允许联网",
    );
    expect(document.querySelector("[data-popup-status]")?.textContent).toBe("");
    expect(element<HTMLInputElement>("[data-global-enabled]").getAttribute("role")).toBe("switch");
    expect(element<HTMLInputElement>("[data-site-enabled]").getAttribute("role")).toBe("switch");
    const toggle = element<HTMLInputElement>("[data-site-enabled]");
    expect(toggle.checked).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    expect(sendTabMessage).toHaveBeenLastCalledWith(7, {
      enabled: false,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/popup-site-toggle",
    });
    expect(element<HTMLInputElement>("[data-site-enabled]").checked).toBe(false);
  });

  it("updates the global switch and overlay skin through exact popup runtime messages", async () => {
    renderPage();
    const sendRuntimeMessage = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce({ ...status(), globallyEnabled: false })
      .mockResolvedValueOnce({ ...status(), globallyEnabled: false, overlayTheme: "parchment" });
    const page = new PopupPage({
      openOptionsPage: vi.fn(async () => undefined),
      queryActiveTab: vi.fn(async () => ({ id: 7 })),
      sendRuntimeMessage,
      sendTabMessage: vi.fn(async () => site(true)),
    });
    await page.initialize();

    const global = element<HTMLInputElement>("[data-global-enabled]");
    global.checked = false;
    global.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(global.disabled).toBe(false));
    expect(sendRuntimeMessage).toHaveBeenNthCalledWith(2, {
      enabled: false,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/popup-global-toggle",
    });
    expect(element<HTMLInputElement>("[data-site-enabled]").disabled).toBe(true);

    element<HTMLButtonElement>("[data-toggle-overlay-theme]").click();
    await vi.waitFor(() => expect(document.body.dataset.overlayTheme).toBe("parchment"));
    expect(sendRuntimeMessage).toHaveBeenNthCalledWith(3, {
      messageVersion: STORE_MESSAGE_VERSION,
      overlayTheme: "parchment",
      type: "store/popup-overlay-theme",
    });
  });

  it("shows a stale-tab error and refuses to toggle another active tab", async () => {
    renderPage();
    const queryActiveTab = vi
      .fn()
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ id: 8 });
    const sendTabMessage = vi.fn(async () => site(true));
    const page = new PopupPage({
      openOptionsPage: vi.fn(async () => undefined),
      queryActiveTab,
      sendRuntimeMessage: vi.fn(async () => status()),
      sendTabMessage,
    });
    await page.initialize();

    const toggle = element<HTMLInputElement>("[data-site-enabled]");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(element("[data-popup-status]").textContent).toContain("标签页已切换"),
    );
    expect(sendTabMessage).toHaveBeenCalledOnce();
    expect(toggle.checked).toBe(true);
  });

  it("keeps runtime status when the active tab has no content script", async () => {
    renderPage();
    const page = new PopupPage({
      openOptionsPage: vi.fn(async () => undefined),
      queryActiveTab: vi.fn(async () => ({ id: 7 })),
      sendRuntimeMessage: vi.fn(async () => status()),
      sendTabMessage: vi.fn(async () => {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }),
    });

    await page.initialize();

    expect(element("[data-popup-status]").textContent).toBe("");
    expect(element("[data-site-host]").textContent).toBe("当前标签页不支持划译");
    expect(element("[data-provider]").textContent).toBe("DeepSeek");
    expect(element("[data-model-consent]").textContent).toBe("已允许联网");
    expect(document.querySelector("[data-credential]")).toBeNull();
    expect(element<HTMLInputElement>("[data-site-enabled]").disabled).toBe(true);
  });

  it("opens Settings without depending on the current tab state", async () => {
    renderPage();
    const openOptionsPage = vi.fn(async () => undefined);
    const page = new PopupPage({
      openOptionsPage,
      queryActiveTab: vi.fn(async () => null),
      sendRuntimeMessage: vi.fn(async () => status()),
      sendTabMessage: vi.fn(async () => site(true)),
    });

    await page.initialize();
    element<HTMLButtonElement>("[data-open-options]").click();

    await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledOnce());
    expect(element("[data-popup-status]").textContent).toBe("");
  });

  it("shows a recoverable error when Settings cannot be opened", async () => {
    renderPage();
    const page = new PopupPage({
      openOptionsPage: vi.fn(async () => {
        throw new Error("options unavailable");
      }),
      queryActiveTab: vi.fn(async () => null),
      sendRuntimeMessage: vi.fn(async () => status()),
      sendTabMessage: vi.fn(async () => site(true)),
    });

    await page.initialize();
    element<HTMLButtonElement>("[data-open-options]").click();

    await vi.waitFor(() =>
      expect(element("[data-popup-status]").textContent).toBe("无法打开设置页，请稍后重试。"),
    );
    expect(element("[data-popup-status]").dataset.tone).toBe("error");
  });

  it("keeps the generic error when runtime status cannot be read", async () => {
    renderPage();
    const page = new PopupPage({
      openOptionsPage: vi.fn(async () => undefined),
      queryActiveTab: vi.fn(async () => ({ id: 7 })),
      sendRuntimeMessage: vi.fn(async () => {
        throw new Error("worker unavailable");
      }),
      sendTabMessage: vi.fn(async () => site(true)),
    });

    await page.initialize();

    expect(element("[data-popup-status]").textContent).toBe("扩展状态读取失败，请稍后重试。");
    expect(element<HTMLInputElement>("[data-site-enabled]").disabled).toBe(true);
  });
});
