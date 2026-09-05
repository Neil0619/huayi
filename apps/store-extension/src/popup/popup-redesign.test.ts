import { readFileSync } from "node:fs";
import { STORE_MESSAGE_VERSION, type StoreAppearance } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupPage } from "./popup-page.js";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});

async function setup(failSave = false) {
  document.documentElement.innerHTML = readFileSync(
    "apps/store-extension/pages/popup.html",
    "utf8",
  );
  let appearance: StoreAppearance = "silver";
  const page = new PopupPage({
    appearance: {
      get: async () => appearance,
      set: async (value) => {
        if (failSave) throw new Error("storage");
        appearance = value;
      },
    },
    notifySettingsChanged: vi.fn(async () => undefined),
    openOptionsPage: vi.fn(),
    queryActiveTab: async () => null,
    sendTabMessage: vi.fn(),
    sendRuntimeMessage: async (message) => {
      const type = (message as { type: string }).type;
      if (type === "store/cloud-session-status")
        return {
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/cloud-session-result",
          status: "disconnected",
        };
      if (type === "store/submission-outbox-status")
        return {
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/submission-outbox-result",
          state: "empty",
          outcome: "status",
        };
      return {
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-status-result",
        providerId: "deepseek",
        modelConsentGranted: true,
        globallyEnabled: true,
        appearance,
        overlayTheme: "pearl",
      };
    },
  });
  await page.initialize();
  return page;
}

describe("compact popup redesign", () => {
  it("hides an empty outbox, shows a consent indicator and selects one of four themes", async () => {
    await setup();
    expect(document.querySelector<HTMLElement>(".outbox-row")?.hidden).toBe(true);
    expect(document.querySelector("[data-model-consent]")?.getAttribute("aria-label")).toBe(
      "已允许模型联网",
    );
    document.querySelector<HTMLButtonElement>("[data-toggle-appearance]")?.click();
    expect(document.querySelector<HTMLElement>("[data-popup-appearance]")?.hidden).toBe(false);
    expect(document.querySelectorAll("[data-popup-theme]")).toHaveLength(4);
    document.querySelector<HTMLButtonElement>("[data-popup-theme='porcelain']")?.click();
    await vi.waitFor(() => expect(document.documentElement.dataset.appearance).toBe("porcelain"));
  });

  it("restores the previous appearance when persistence fails", async () => {
    await setup(true);
    document.querySelector<HTMLButtonElement>("[data-popup-theme='champagne']")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-popup-status]")?.textContent).toContain("已恢复"),
    );
    expect(document.documentElement.dataset.appearance).toBe("silver");
  });
});
