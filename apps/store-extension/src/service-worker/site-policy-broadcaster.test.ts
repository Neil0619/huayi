import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleSitePoliciesChanged } from "./site-policy-broadcaster.js";

describe("Store site policy broadcaster", () => {
  it("accepts only exact Options and broadcasts no host or settings data", async () => {
    const broadcast = vi.fn(async () => undefined);
    await expect(
      handleSitePoliciesChanged(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policies-changed" },
        { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
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
  });
});
