import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoreSiteLifecycle } from "./site-lifecycle-registry.js";
import { installStoreSitePolicyRelay } from "./site-policy-relay.js";

const RELAY_KEY = Symbol.for("@huayi/store-extension/site-policy-relay");

describe("Store content site policy relay", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, RELAY_KEY));

  it("relays an exact popup request once and applies the worker result", async () => {
    let listener:
      | ((
          message: unknown,
          sender: { id?: string; url?: string },
          send: (value: unknown) => void,
        ) => boolean | undefined)
      | undefined;
    const runtime = {
      addListener: vi.fn((value: typeof listener) => {
        listener = value;
      }),
      extensionId: "extension-id",
    };
    const response = {
      appearance: "silver" as const,
      defaultAction: "ask" as const,
      enabled: false,
      globallyEnabled: true,
      host: "example.com",
      messageVersion: STORE_MESSAGE_VERSION,
      overlayTheme: "pearl" as const,
      type: "store/site-policy-result" as const,
    };
    const lifecycle = {
      refresh: vi.fn(async () => response),
      toggle: vi.fn(async () => response),
    } as unknown as StoreSiteLifecycle;
    installStoreSitePolicyRelay(lifecycle, runtime);
    installStoreSitePolicyRelay(lifecycle, runtime);
    expect(runtime.addListener).toHaveBeenCalledOnce();

    const sendResponse = vi.fn();
    expect(
      listener?.(
        {
          enabled: false,
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/popup-site-toggle",
        },
        { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(response));
    expect(lifecycle.toggle).toHaveBeenCalledWith(false);

    expect(
      listener?.(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/popup-site-policy" },
        { id: "extension-id", url: "https://page.example/" },
        sendResponse,
      ),
    ).toBe(false);
    expect(lifecycle.refresh).not.toHaveBeenCalled();
  });
});
