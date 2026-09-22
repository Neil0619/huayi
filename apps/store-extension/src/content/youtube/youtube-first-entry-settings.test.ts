// @vitest-environment-options {"url":"https://www.youtube.com/"}

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleContentSettingsMessage } from "../../service-worker/content-settings-handler.js";
import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { YouTubeIntegration } from "./youtube-integration.js";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

describe("Store YouTube first-entry settings authorization", () => {
  it("activates after SPA entry with the original homepage sender URL and stops on leave", async () => {
    vi.useFakeTimers();
    // Chromium's message sender URL can remain the URL where this script context was created.
    const senderUrl = document.location.href;
    expect(senderUrl).toBe("https://www.youtube.com/");
    const controller = { start: vi.fn(), stop: vi.fn() };
    const createController = vi.fn(() => controller);
    const setAppearance = vi.fn();
    const sendMessage = vi.fn((message: unknown) =>
      handleContentSettingsMessage(
        message,
        senderUrl,
        async () => ({
          globallyEnabled: true,
          sitePolicy: { defaultAction: "allow", rules: [] },
          youtubeMode: "bilingual",
          youtubeShortcut: null,
        }),
        async () => "porcelain",
      ),
    );
    const integration = new YouTubeIntegration({
      createController,
      document,
      overlay: { setAppearance } as unknown as StoreOverlayController,
      sendMessage,
    });

    try {
      integration.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(createController).not.toHaveBeenCalled();

      window.history.pushState(null, "", "/watch?v=video-1");
      document.dispatchEvent(new Event("yt-navigate-finish"));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(controller.start).toHaveBeenCalledOnce();
      expect(createController).toHaveBeenCalledWith("bilingual", null, "porcelain");
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(setAppearance).toHaveBeenCalledWith("porcelain");

      document.dispatchEvent(new Event("yt-navigate-start"));
      expect(controller.stop).toHaveBeenCalledOnce();
      window.history.pushState(null, "", "/feed/subscriptions");
      document.dispatchEvent(new Event("yt-navigate-finish"));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(createController).toHaveBeenCalledOnce();
    } finally {
      integration.stop();
    }
  });
});
