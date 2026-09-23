import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { broadcastSettingsRefresh } from "./settings-refresh-broadcaster.js";

describe("settings refresh notifications", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatches to every valid tab without waiting for a suspended tab's response", async () => {
    const sendMessage = vi.fn((tabId: number) =>
      tabId === 1 ? new Promise<never>(() => undefined) : Promise.resolve(undefined),
    );
    vi.stubGlobal("chrome", {
      tabs: { query: async () => [{ id: 1 }, {}, { id: 2 }], sendMessage },
    });

    await broadcastSettingsRefresh();

    expect(sendMessage.mock.calls).toEqual([
      [1, { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy-refresh" }],
      [2, { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy-refresh" }],
    ]);
  });

  it("tolerates missing receivers and late closed-tab failures after dispatch", async () => {
    let closeTab: (error: Error) => void = () => undefined;
    const closingTab = new Promise<never>((_resolve, reject) => {
      closeTab = reject;
    });
    const sendMessage = vi.fn((tabId: number) => {
      if (tabId === 1) return Promise.reject(new Error("No receiver"));
      if (tabId === 2) return closingTab;
      return Promise.resolve(undefined);
    });
    vi.stubGlobal("chrome", {
      tabs: { query: async () => [{ id: 1 }, { id: 2 }, { id: 3 }], sendMessage },
    });

    await expect(broadcastSettingsRefresh()).resolves.toBeUndefined();
    closeTab(new Error("Tab closed"));
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});
