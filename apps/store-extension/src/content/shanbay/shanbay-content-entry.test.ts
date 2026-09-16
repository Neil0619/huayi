import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

type Listener = (
  message: unknown,
  sender: { id?: string },
  respond: (value: unknown) => void,
) => unknown;
const collection = "https://web.shanbay.com/wordsweb/#/collection";
const lifecycleKey = Symbol.for("@huayi/store-extension/site-lifecycle");
const relayKey = Symbol.for("@huayi/store-extension/site-policy-relay");
const realWindow = window;

beforeEach(() => {
  vi.resetModules();
  delete document.documentElement.dataset.huayiStoreReloadRequired;
  delete document.documentElement.dataset.huayiStoreUnavailable;
  Reflect.deleteProperty(globalThis, lifecycleKey);
  Reflect.deleteProperty(globalThis, relayKey);
});
afterEach(() => {
  realWindow.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, lifecycleKey);
  Reflect.deleteProperty(globalThis, relayKey);
  document.body.replaceChildren();
});

async function mount(url = collection, child = false, compatible = true, enabled = true) {
  // Use the real DOM controller and lifecycle; spies suppress only page automation in this
  // entrypoint test. The packaged browser fixture separately exercises the full submission flow.
  const controller = await import("./backfill-page-controller.js");
  const start = vi.spyOn(controller.BackfillPageController.prototype, "start").mockResolvedValue();
  const stop = vi
    .spyOn(controller.BackfillPageController.prototype, "stop")
    .mockImplementation(() => undefined);
  const activate = vi
    .spyOn(controller.BackfillPageController.prototype, "activate")
    .mockResolvedValue();
  const review = vi
    .spyOn(controller.BackfillPageController.prototype, "openReview")
    .mockResolvedValue();
  const listeners: Listener[] = [];
  const location = new URL(url);
  const pageWindow = {
    location,
    top: null as unknown,
    addEventListener: realWindow.addEventListener.bind(realWindow),
  };
  pageWindow.top = child ? realWindow : pageWindow;
  vi.stubGlobal("window", pageWindow);
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    if (message.type === "store/handshake")
      return compatible
        ? {
            compatible: true,
            extensionVersion: "1.0.0",
            messageVersion: STORE_MESSAGE_VERSION,
            requestId: message.requestId,
            type: "store/handshake-result",
          }
        : {
            compatible: false,
            expectedMessageVersion: STORE_MESSAGE_VERSION,
            receivedMessageVersion: 0,
            requestId: message.requestId,
            type: "store/handshake-result",
          };
    if (message.type === "store/site-policy")
      return {
        appearance: "silver",
        defaultAction: "explain",
        enabled,
        globallyEnabled: true,
        host: "web.shanbay.com",
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "pearl",
        type: "store/site-policy-result",
      };
    throw new Error("Unexpected message");
  });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      sendMessage,
      onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
    },
  });
  await import("./shanbay-content-entry.js");
  return { listeners, location, sendMessage, start, stop, activate, review };
}

it.each([
  ["https://example.test/wordsweb/#/collection", false],
  ["https://web.shanbay.com.evil.test/wordsweb/#/collection", false],
  ["http://web.shanbay.com/wordsweb/#/collection", false],
  ["https://web.shanbay.com/wordsweb/?query=1#/collection", false],
  ["https://web.shanbay.com/wordsweb/#/other", false],
  [collection, true],
])(
  "does not initialize outside the exact top-level collection: %s child=%s",
  async (url, child) => {
    const entry = await mount(url, child);
    expect(entry.listeners).toEqual([]);
    expect(entry.sendMessage).not.toHaveBeenCalled();
    expect(entry.start).not.toHaveBeenCalled();
  },
);

it("retains the handshake and site-policy gates", async () => {
  const entry = await mount(collection, false, false);
  await vi.waitFor(() =>
    expect(document.documentElement.dataset.huayiStoreReloadRequired).toBe("true"),
  );
  expect(entry.start).not.toHaveBeenCalled();
  expect(entry.sendMessage).toHaveBeenCalledOnce();
});

it("keeps disabled sites stopped", async () => {
  const entry = await mount(collection, false, true, false);
  await vi.waitFor(() => expect(entry.sendMessage).toHaveBeenCalledTimes(2));
  expect(entry.start).not.toHaveBeenCalled();
});

it("probes and activates only for this extension and the current collection, and stops on pagehide", async () => {
  const entry = await mount();
  await vi.waitFor(() => expect(entry.start).toHaveBeenCalledOnce());
  const respond = vi.fn();
  const deliver = (message: unknown, id = "extension") => {
    for (const listener of entry.listeners) listener(message, { id }, respond);
  };
  deliver({ type: "store/backfill-probe" }, "other");
  deliver({ type: "store/backfill-activate" }, "other");
  expect(respond).not.toHaveBeenCalled();
  expect(entry.activate).not.toHaveBeenCalled();
  deliver({ type: "store/backfill-probe" });
  expect(respond).toHaveBeenLastCalledWith({ shanbayCollection: true });
  deliver({ type: "store/backfill-activate" });
  deliver({ type: "store/backfill-activate", view: "review" });
  expect(entry.activate).toHaveBeenCalledOnce();
  expect(entry.review).toHaveBeenCalledOnce();
  entry.location.hash = "#/other";
  deliver({ type: "store/backfill-probe" });
  expect(respond).toHaveBeenLastCalledWith({ shanbayCollection: false });
  deliver({ type: "store/backfill-activate" });
  deliver({ type: "store/backfill-activate", view: "review" });
  expect(entry.activate).toHaveBeenCalledOnce();
  expect(entry.review).toHaveBeenCalledOnce();
  realWindow.dispatchEvent(new Event("pagehide"));
  expect(entry.stop).toHaveBeenCalledOnce();
});
