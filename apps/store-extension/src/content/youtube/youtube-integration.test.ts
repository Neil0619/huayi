import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { YouTubeIntegration } from "./youtube-integration.js";

afterEach(() => {
  vi.useRealTimers();
});

function overlay(): StoreOverlayController {
  return {
    setAppearance: vi.fn(),
    setDefaultAction: vi.fn(),
    setTheme: vi.fn(),
  } as unknown as StoreOverlayController;
}

describe("Store YouTube SPA integration", () => {
  it("stays inert on a cold non-watch page, activates on SPA watch, and tears down on leave", async () => {
    let watchPage = false;
    const controller = { start: vi.fn(), stop: vi.fn() };
    const createController = vi.fn(() => controller);
    const storeOverlay = overlay();
    const sendMessage = vi.fn(async () => ({
      appearance: "porcelain" as const,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings-result",
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    }));
    const integration = new YouTubeIntegration({
      createController,
      createRandomId: () => "random-id",
      document,
      isWatchPage: () => watchPage,
      overlay: storeOverlay,
      sendMessage,
    });

    integration.start();
    await Promise.resolve();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createController).not.toHaveBeenCalled();

    watchPage = true;
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await vi.waitFor(() => expect(controller.start).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(createController).toHaveBeenCalledOnce();
    expect(storeOverlay.setAppearance).toHaveBeenCalledWith("porcelain");

    watchPage = false;
    document.dispatchEvent(new Event("yt-navigate-start"));
    expect(controller.stop).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledOnce();

    integration.stop();
  });

  it("does not activate from a settings response that arrives after site stop", async () => {
    let finishSettings: ((value: unknown) => void) | undefined;
    const createController = vi.fn(() => ({ start: vi.fn(), stop: vi.fn() }));
    const integration = new YouTubeIntegration({
      createController,
      document,
      isWatchPage: () => true,
      overlay: overlay(),
      sendMessage: () =>
        new Promise((resolve) => {
          finishSettings = resolve;
        }),
    });

    integration.start();
    integration.stop();
    finishSettings?.({
      appearance: "silver",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings-result",
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    });
    await Promise.resolve();

    expect(createController).not.toHaveBeenCalled();
  });

  it("recovers from one transient settings failure without waiting for navigation", async () => {
    vi.useFakeTimers();
    const controller = { start: vi.fn(), stop: vi.fn() };
    const createController = vi.fn(() => controller);
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker starting"))
      .mockResolvedValueOnce({
        appearance: "silver",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/content-settings-result",
        youtubeMode: "bilingual",
        youtubeShortcut: null,
      });
    const integration = new YouTubeIntegration({
      createController,
      document,
      isWatchPage: () => true,
      overlay: overlay(),
      sendMessage,
    });

    integration.start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(createController).toHaveBeenCalledOnce();
    expect(controller.start).toHaveBeenCalledOnce();
    integration.stop();
  });

  it("stops after exactly three failed settings attempts", async () => {
    vi.useFakeTimers();
    const createController = vi.fn(() => ({ start: vi.fn(), stop: vi.fn() }));
    const sendMessage = vi.fn().mockRejectedValue(new Error("worker unavailable"));
    const integration = new YouTubeIntegration({
      createController,
      document,
      isWatchPage: () => true,
      overlay: overlay(),
      sendMessage,
    });

    integration.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(createController).not.toHaveBeenCalled();
    integration.stop();
  });

  it("does not retry settings after stop during the bounded backoff", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockRejectedValue(new Error("worker unavailable"));
    const integration = new YouTubeIntegration({
      createController: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
      document,
      isWatchPage: () => true,
      overlay: overlay(),
      sendMessage,
    });

    integration.start();
    await Promise.resolve();
    integration.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("coalesces overlapping navigation-finish initialization requests", async () => {
    let finishSettings: ((value: unknown) => void) | undefined;
    const controller = { start: vi.fn(), stop: vi.fn() };
    const sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSettings = resolve;
        }),
    );
    const integration = new YouTubeIntegration({
      createController: () => controller,
      document,
      isWatchPage: () => true,
      overlay: overlay(),
      sendMessage,
    });

    integration.start();
    document.dispatchEvent(new Event("yt-navigate-finish"));
    document.dispatchEvent(new Event("yt-navigate-finish"));
    expect(sendMessage).toHaveBeenCalledOnce();

    finishSettings?.({
      appearance: "champagne",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings-result",
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    });
    await vi.waitFor(() => expect(controller.start).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledOnce();
    integration.stop();
  });
});
