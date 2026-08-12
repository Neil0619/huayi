import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleContentSettingsMessage } from "./content-settings-handler.js";

const request = { messageVersion: STORE_MESSAGE_VERSION, type: "store/content-settings" };

describe("Store content settings handler", () => {
  it("returns only YouTube mode to exact HTTPS YouTube content senders", async () => {
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
      ),
    ).resolves.toEqual({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings-result",
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    });
    await expect(
      handleContentSettingsMessage(request, "https://youtube.example/watch", readSettings),
    ).resolves.toBeUndefined();
    await expect(
      handleContentSettingsMessage(request, "http://www.youtube.com/watch?v=video-1", readSettings),
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
      ),
    ).resolves.toBeUndefined();
  });
});
