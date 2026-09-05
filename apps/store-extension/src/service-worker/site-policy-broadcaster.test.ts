import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleSitePoliciesChanged } from "./site-policy-broadcaster.js";

describe("Store site policy broadcaster", () => {
  it.each(["options", "popup"])(
    "accepts exact %s and broadcasts no host or settings data",
    async (page) => {
      const broadcast = vi.fn(async () => undefined);
      await expect(
        handleSitePoliciesChanged(
          { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policies-changed" },
          { id: "extension-id", url: `chrome-extension://extension-id/${page}.html` },
          "extension-id",
          broadcast,
        ),
      ).resolves.toEqual({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policies-refreshed",
      });
      expect(broadcast).toHaveBeenCalledWith({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policy-refresh",
      });

      await expect(
        handleSitePoliciesChanged(
          {
            host: "example.com",
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/site-policies-changed",
          },
          { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
          "extension-id",
          broadcast,
        ),
      ).resolves.toBeUndefined();
      expect(broadcast).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { id: "extension-id", url: "https://example.com/popup.html" },
    { id: "other-id", url: "chrome-extension://extension-id/popup.html" },
    { id: "extension-id", url: "chrome-extension://extension-id/popup.html?theme=moon" },
    { id: "extension-id", url: "chrome-extension://extension-id/options.html#theme" },
    { id: "extension-id", url: "chrome-extension://extension-id/other.html" },
  ])("rejects untrusted or parameterized senders: %s", async (sender) => {
    const broadcast = vi.fn();
    await expect(
      handleSitePoliciesChanged(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policies-changed" },
        sender,
        "extension-id",
        broadcast,
      ),
    ).resolves.toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
