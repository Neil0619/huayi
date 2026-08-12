import { describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { requestVersionHandshake } from "./content/version-handshake.js";
import { handleStoreMessage } from "./service-worker/store-message-handler.js";

describe("Store extension version handshake", () => {
  it("accepts a current content script", async () => {
    const sendMessage = vi.fn(async (message: unknown) => handleStoreMessage(message, "1.0.0"));

    await expect(requestVersionHandshake(sendMessage, "request-1")).resolves.toEqual({
      compatible: true,
      extensionVersion: "1.0.0",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: "request-1",
      type: "store/handshake-result",
    });
  });

  it("asks a stale content script to reload without accepting its contract", () => {
    expect(
      handleStoreMessage(
        { messageVersion: 0, requestId: "request-old", type: "store/handshake" },
        "1.0.0",
      ),
    ).toEqual({
      compatible: false,
      expectedMessageVersion: STORE_MESSAGE_VERSION,
      receivedMessageVersion: 0,
      requestId: "request-old",
      type: "store/handshake-result",
    });
  });

  it("ignores unrelated or malformed messages", () => {
    expect(
      handleStoreMessage({ type: "analyze", url: "https://attacker.invalid" }, "1.0.0"),
    ).toBeUndefined();
    expect(handleStoreMessage(null, "1.0.0")).toBeUndefined();
  });
});
