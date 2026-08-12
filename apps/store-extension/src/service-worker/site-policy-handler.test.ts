import { STORE_MESSAGE_VERSION, type StoreSettings } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleSitePolicyMessage } from "./site-policy-handler.js";

const settings: StoreSettings = {
  defaultAction: "translate",
  globallyEnabled: true,
  networkConsent: null,
  overlayTheme: "pearl",
  providerId: "openai",
  recipientAccess: {
    eudic: { consent: null, enabled: false },
    shanbay: { consent: null, enabled: false },
  },
  schemaVersion: 6,
  sitePolicy: {
    defaultAction: "allow",
    rules: [{ action: "block", hostname: "example.com", includeSubdomains: true }],
  },
  youtubeMode: "english",
  youtubeShortcut: null,
};

describe("Store site policy handler", () => {
  it("derives the canonical host only from sender URL", async () => {
    const get = vi.fn(async () => settings);
    const setSiteEnabled = vi.fn(async () => undefined);

    await expect(
      handleSitePolicyMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy" },
        "https://EXAMPLE.com/article?private=1",
        { get, setSiteEnabled },
      ),
    ).resolves.toEqual({
      defaultAction: "translate",
      enabled: false,
      globallyEnabled: true,
      host: "example.com",
      messageVersion: STORE_MESSAGE_VERSION,
      overlayTheme: "pearl",
      type: "store/site-policy-result",
    });
    expect(setSiteEnabled).not.toHaveBeenCalled();
  });

  it("toggles only the sender host and rejects host-bearing or untrusted requests", async () => {
    const get = vi.fn(async () => ({
      ...settings,
      sitePolicy: { defaultAction: "allow" as const, rules: [] },
    }));
    const setSiteEnabled = vi.fn(async () => undefined);
    const repository = { get, setSiteEnabled };

    await expect(
      handleSitePolicyMessage(
        {
          enabled: false,
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/site-toggle",
        },
        "https://sub.example.com/page",
        repository,
      ),
    ).resolves.toMatchObject({ enabled: false, host: "sub.example.com" });
    expect(setSiteEnabled).toHaveBeenCalledWith("sub.example.com", false);

    await expect(
      handleSitePolicyMessage(
        {
          enabled: false,
          host: "other.example",
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/site-toggle",
        },
        "https://sub.example.com/page",
        repository,
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleSitePolicyMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy" },
        "chrome://settings",
        repository,
      ),
    ).resolves.toBeUndefined();
    expect(setSiteEnabled).toHaveBeenCalledOnce();
  });
});
