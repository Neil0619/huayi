import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleContentSettingsMessage } from "./content-settings-handler.js";

const request = { messageVersion: STORE_MESSAGE_VERSION, type: "store/content-settings" };

describe("Store content settings handler", () => {
  it.each(
    ["youtube.com", "www.youtube.com", "m.youtube.com"].flatMap((host) =>
      ["/", "/feed/subscriptions", "/watch?v=video-1"].map((path) => `https://${host}${path}`),
    ),
  )("allows presentation settings from the exact HTTPS sender %s", async (senderUrl) => {
    await expect(
      handleContentSettingsMessage(
        request,
        senderUrl,
        async () => ({
          globallyEnabled: true,
          sitePolicy: { defaultAction: "allow", rules: [] },
          youtubeMode: "english",
          youtubeShortcut: null,
        }),
        async () => "silver",
      ),
    ).resolves.toEqual({
      appearance: "silver",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings-result",
      youtubeMode: "english",
      youtubeShortcut: null,
    });
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "/watch?v=video-1",
    "http://www.youtube.com/",
    "https://youtube.example/watch",
    "https://www.youtube.com.example/watch",
    "https://evil.youtube.com/watch",
    "https://www.youtube.com@evil.example/watch",
    "https://www.youtube.com./watch",
  ])("rejects untrusted sender %s before reading settings", async (senderUrl) => {
    const readSettings = vi.fn();
    const readAppearance = vi.fn();
    await expect(
      handleContentSettingsMessage(request, senderUrl, readSettings, readAppearance),
    ).resolves.toBeUndefined();
    expect(readSettings).not.toHaveBeenCalled();
    expect(readAppearance).not.toHaveBeenCalled();
  });

  it.each(
    [
      undefined,
      null,
      [],
      "store/content-settings",
      { ...request, type: "store/other" },
      { type: "store/content-settings" },
      { ...request, messageVersion: STORE_MESSAGE_VERSION + 1 },
      { ...request, unexpected: true },
    ].map((message) => ({ message })),
  )("rejects malformed request $message before reading settings", async ({ message }) => {
    const readSettings = vi.fn();
    const readAppearance = vi.fn();
    await expect(
      handleContentSettingsMessage(
        message,
        "https://www.youtube.com/",
        readSettings,
        readAppearance,
      ),
    ).resolves.toBeUndefined();
    expect(readSettings).not.toHaveBeenCalled();
    expect(readAppearance).not.toHaveBeenCalled();
  });

  it.each([
    {
      globallyEnabled: false,
      sitePolicy: { defaultAction: "allow" as const, rules: [] },
    },
    {
      globallyEnabled: true,
      sitePolicy: { defaultAction: "block" as const, rules: [] },
    },
    {
      globallyEnabled: true,
      sitePolicy: {
        defaultAction: "allow" as const,
        rules: [
          { action: "block" as const, hostname: "www.youtube.com", includeSubdomains: false },
        ],
      },
    },
  ])("does not disclose settings to a disabled homepage: %j", async (policy) => {
    const readAppearance = vi.fn();
    await expect(
      handleContentSettingsMessage(
        request,
        "https://www.youtube.com/",
        async () => ({ ...policy, youtubeMode: "english", youtubeShortcut: null }),
        readAppearance,
      ),
    ).resolves.toBeUndefined();
    expect(readAppearance).not.toHaveBeenCalled();
  });

  it("returns only appearance and YouTube presentation settings to exact HTTPS senders", async () => {
    const readSettings = vi.fn(async () => ({
      globallyEnabled: true,
      sitePolicy: { defaultAction: "allow" as const, rules: [] },
      youtubeMode: "bilingual" as const,
      youtubeShortcut: null,
    }));

    await expect(
      handleContentSettingsMessage(
        request,
        "https://www.youtube.com/watch?v=video-1",
        readSettings,
        async () => "porcelain",
      ),
    ).resolves.toEqual({
      appearance: "porcelain",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings-result",
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    });
    await expect(
      handleContentSettingsMessage(
        request,
        "https://youtube.example/watch",
        readSettings,
        async () => "porcelain",
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleContentSettingsMessage(
        request,
        "http://www.youtube.com/watch?v=video-1",
        readSettings,
        async () => "porcelain",
      ),
    ).resolves.toBeUndefined();
    expect(readSettings).toHaveBeenCalledOnce();
  });

  it("does not disclose YouTube settings when the sender site is disabled", async () => {
    const readSettings = vi.fn(async () => ({
      globallyEnabled: true,
      sitePolicy: {
        defaultAction: "allow" as const,
        rules: [
          {
            action: "block" as const,
            hostname: "youtube.com",
            includeSubdomains: true,
          },
        ],
      },
      youtubeMode: "bilingual" as const,
      youtubeShortcut: null,
    }));

    await expect(
      handleContentSettingsMessage(
        request,
        "https://www.youtube.com/watch?v=video-1",
        readSettings,
        async () => "moon",
      ),
    ).resolves.toBeUndefined();
  });
});
