import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { PopupPage } from "./popup-page.js";

const html = readFileSync("apps/store-extension/pages/popup.html", "utf8");
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});
it.each([
  ["platform", null, "云端模型"],
  ["byok", "deepseek", "DeepSeek"],
  ["byok", "openai", "OpenAI"],
  ["unavailable", null, "模型状态不可用"],
] as const)(
  "shows actual %s mode without a saved-provider fallback",
  async (queryMode, providerId, label) => {
    document.documentElement.innerHTML = html;
    const page = new PopupPage({
      queryActiveTab: async () => null,
      openOptionsPage: async () => undefined,
      sendTabMessage: async () => undefined,
      sendRuntimeMessage: async () => ({
        appearance: "silver",
        globallyEnabled: true,
        messageVersion: STORE_MESSAGE_VERSION,
        modelConsentGranted: true,
        overlayTheme: "pearl",
        queryMode,
        providerId,
        type: "store/popup-status-result",
      }),
    });
    await page.initialize();
    expect(document.querySelector("[data-provider]")?.textContent).toBe(label);
  },
);
it("discards a delayed initial model response after preferences have refreshed", async () => {
  document.documentElement.innerHTML = html;
  let finish: (value: unknown) => void = () => undefined;
  const initial = new Promise((resolve) => {
    finish = resolve;
  });
  const callbacks: (() => void)[] = [];
  let calls = 0;
  const status = {
    appearance: "silver",
    globallyEnabled: true,
    messageVersion: STORE_MESSAGE_VERSION,
    modelConsentGranted: true,
    overlayTheme: "pearl",
    type: "store/popup-status-result",
  };
  const page = new PopupPage({
    queryActiveTab: async () => null,
    openOptionsPage: async () => undefined,
    sendTabMessage: async () => undefined,
    subscribeToCloudSession: (callback) => {
      callbacks.push(callback);
      return () => undefined;
    },
    sendRuntimeMessage: async (message) => {
      if ((message as { type: string }).type !== "store/popup-status") return undefined;
      calls += 1;
      return calls === 1 ? initial : { ...status, queryMode: "platform", providerId: null };
    },
  });
  const ready = page.initialize();
  expect(document.querySelector("[data-provider]")?.textContent).toBe("正在读取…");
  callbacks[0]?.();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-provider]")?.textContent).toBe("云端模型"),
  );
  finish({ ...status, queryMode: "byok", providerId: "deepseek" });
  await ready;
  expect(document.querySelector("[data-provider]")?.textContent).toBe("云端模型");
});
