import { beforeEach, describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { bootstrapStoreContentScript } from "./content-bootstrap.js";
import { createYouTubeStartupRetryExecutor } from "./youtube/youtube-startup-retry.js";

describe("Store content bootstrap", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.huayiStoreReloadRequired;
    delete document.documentElement.dataset.huayiStoreUnavailable;
  });

  it("does not enable selection until a compatible handshake succeeds", async () => {
    const start = vi.fn();
    const sendMessage = vi.fn(async () => ({
      compatible: true,
      extensionVersion: "1.0.0",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: "handshake-1",
      type: "store/handshake-result",
    }));

    await bootstrapStoreContentScript({
      createApp: () => ({ start }),
      createRequestId: () => "handshake-1",
      sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it("leaves selection disabled and marks stale or unavailable pages", async () => {
    const staleStart = vi.fn();
    await bootstrapStoreContentScript({
      createApp: () => ({ start: staleStart }),
      createRequestId: () => "handshake-old",
      sendMessage: async () => ({
        compatible: false,
        expectedMessageVersion: STORE_MESSAGE_VERSION,
        receivedMessageVersion: 0,
        requestId: "handshake-old",
        type: "store/handshake-result",
      }),
    });
    expect(staleStart).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.huayiStoreReloadRequired).toBe("true");

    await bootstrapStoreContentScript({
      createApp: () => ({ start: vi.fn() }),
      createRequestId: () => "handshake-fail",
      sendMessage: async () => {
        throw new Error("Extension context invalidated");
      },
    });
    expect(document.documentElement.dataset.huayiStoreUnavailable).toBe("true");
  });

  it("recovers a YouTube handshake before marking the page unavailable", async () => {
    const start = vi.fn();
    const waitForRetry = vi.fn(async () => undefined);
    const runStartupStep = createYouTubeStartupRetryExecutor({ waitForRetry });
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker starting"))
      .mockResolvedValueOnce({
        compatible: true,
        extensionVersion: "1.0.0",
        messageVersion: STORE_MESSAGE_VERSION,
        requestId: "handshake-recovered",
        type: "store/handshake-result",
      });

    await bootstrapStoreContentScript({
      createApp: () => ({ start }),
      createRequestId: () => "handshake-recovered",
      runStartupStep,
      sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.huayiStoreUnavailable).toBeUndefined();
  });

  it("marks YouTube unavailable only after all three handshake attempts fail", async () => {
    const createApp = vi.fn(() => ({ start: vi.fn() }));
    const waitForRetry = vi.fn(async () => undefined);
    const sendMessage = vi.fn().mockRejectedValue(new Error("worker unavailable"));

    await bootstrapStoreContentScript({
      createApp,
      createRequestId: () => "handshake-unavailable",
      runStartupStep: createYouTubeStartupRetryExecutor({ waitForRetry }),
      sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(waitForRetry).toHaveBeenCalledTimes(2);
    expect(createApp).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.huayiStoreUnavailable).toBe("true");
  });
});
