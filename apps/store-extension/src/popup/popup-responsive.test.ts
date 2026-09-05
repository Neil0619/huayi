import { readFileSync } from "node:fs";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, expect, it, vi } from "vitest";

import { PopupPage } from "./popup-page.js";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

it("makes local controls usable while account and outbox reads are still pending", async () => {
  document.documentElement.innerHTML = readFileSync(
    "apps/store-extension/pages/popup.html",
    "utf8",
  );
  let finishAccount: (value: unknown) => void = () => undefined;
  let finishOutbox: (value: unknown) => void = () => undefined;
  const account = new Promise<unknown>((resolve) => {
    finishAccount = resolve;
  });
  const outbox = new Promise<unknown>((resolve) => {
    finishOutbox = resolve;
  });
  const openOptionsPage = vi.fn(async () => undefined);
  const appearance = { get: async () => "porcelain" as const, set: vi.fn(async () => undefined) };
  const page = new PopupPage({
    appearance,
    openOptionsPage,
    queryActiveTab: async () => ({ id: 7 }),
    sendTabMessage: async () => ({
      appearance: "porcelain",
      defaultAction: "ask",
      enabled: true,
      globallyEnabled: true,
      host: "example.com",
      messageVersion: STORE_MESSAGE_VERSION,
      overlayTheme: "pearl",
      type: "store/site-policy-result",
    }),
    sendRuntimeMessage: async (message) => {
      const type = (message as { type: string }).type;
      if (type === "store/cloud-session-status") return account;
      if (type === "store/submission-outbox-status") return outbox;
      return {
        appearance: "porcelain",
        globallyEnabled: true,
        messageVersion: STORE_MESSAGE_VERSION,
        modelConsentGranted: true,
        overlayTheme: "pearl",
        providerId: "deepseek",
        type: "store/popup-status-result",
      };
    },
  });
  const initializing = page.initialize();
  try {
    await vi.waitFor(
      () => {
        expect(document.querySelector<HTMLInputElement>("[data-global-enabled]")?.disabled).toBe(
          false,
        );
        expect(document.querySelector<HTMLInputElement>("[data-site-enabled]")?.disabled).toBe(
          false,
        );
        expect(document.documentElement.dataset.appearance).toBe("porcelain");
      },
      { timeout: 200 },
    );
    document.querySelector<HTMLButtonElement>("[data-open-options]")?.click();
    await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledOnce());
  } finally {
    finishAccount({
      status: "not-configured",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/cloud-session-result",
    });
    finishOutbox({
      state: "empty",
      outcome: "status",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/submission-outbox-result",
    });
    await initializing;
  }
});
