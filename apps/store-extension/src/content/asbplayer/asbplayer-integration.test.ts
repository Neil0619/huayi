import { afterEach, describe, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION, type StoreSitePolicyResponse } from "@huayi/store-domain";
import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { AsbplayerIntegration } from "./asbplayer-integration.js";
const policy: StoreSitePolicyResponse = {
  messageVersion: STORE_MESSAGE_VERSION,
  type: "store/site-policy-result",
  host: "app.asbplayer.dev",
  enabled: true,
  globallyEnabled: true,
  appearance: "silver",
  defaultAction: "ask",
  overlayTheme: "pearl",
};
const response = {
  messageVersion: STORE_MESSAGE_VERSION,
  type: "store/asbplayer-settings-result",
  appearance: "silver",
  asbplayerMode: "english",
  asbplayerShortcut: null,
};
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
function fixture() {
  const controllers: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setAppearance: ReturnType<typeof vi.fn>;
    updatePreferences: ReturnType<typeof vi.fn>;
  }[] = [];
  const sendMessage = vi.fn(async () => response as unknown);
  const disableMain = vi.fn();
  const integration = new AsbplayerIntegration({
    document,
    overlay: {
      setAppearance: vi.fn(),
      setDefaultAction: vi.fn(),
      setTheme: vi.fn(),
    } as unknown as StoreOverlayController,
    sendMessage,
    disableMain,
    isPlayer: () => true,
    createController: () => {
      const controller = {
        start: vi.fn(),
        stop: vi.fn(),
        setAppearance: vi.fn(),
        updatePreferences: vi.fn(),
      };
      controllers.push(controller);
      return controller;
    },
  });
  return { integration, controllers, sendMessage, disableMain };
}
describe("asbplayer policy and preference lifecycle", () => {
  it("refreshes settings while running and updates mode/shortcut without losing tracks", async () => {
    const h = fixture();
    h.integration.update(policy);
    h.integration.start();
    await settle();
    h.sendMessage.mockResolvedValue({
      ...response,
      asbplayerMode: "bilingual",
      asbplayerShortcut: { code: "KeyT", ctrl: false, alt: true, shift: false, meta: false },
    });
    h.integration.update(policy);
    await settle();
    expect(h.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.controllers).toHaveLength(1);
    expect(h.controllers[0]?.stop).not.toHaveBeenCalled();
    expect(h.controllers[0]?.updatePreferences).toHaveBeenCalledOnce();
    h.integration.stop();
  });
  it("clears the initial MAIN cache on disabled policy even before first start", () => {
    const h = fixture();
    h.integration.update({ ...policy, enabled: false });
    expect(h.disableMain).toHaveBeenCalledOnce();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
  it("ignores late settings after disable and can recreate on re-enable", async () => {
    const h = fixture();
    let resolve: (value: unknown) => void = () => undefined;
    h.sendMessage.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    h.integration.start();
    h.integration.update({ ...policy, enabled: false });
    resolve(response);
    await settle();
    expect(h.controllers).toHaveLength(0);
    h.integration.update(policy);
    h.integration.start();
    await settle();
    expect(h.controllers).toHaveLength(1);
    h.integration.stop();
  });
  it("deactivates after a settings failure without leaving a usable subtitle layer", async () => {
    const h = fixture();
    h.integration.start();
    await settle();
    h.sendMessage.mockRejectedValue(new Error("offline"));
    h.integration.update(policy);
    await settle();
    expect(h.controllers[0]?.stop).toHaveBeenCalledOnce();
    h.integration.stop();
  });
  it("keeps MAIN's one-shot cache through startup retry and starts after transient transport failure", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.sendMessage.mockRejectedValueOnce(new Error("transport unavailable"));
    h.integration.start();
    await vi.advanceTimersByTimeAsync(199);
    expect(h.disableMain).not.toHaveBeenCalled();
    expect(h.sendMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.controllers).toHaveLength(1);
    expect(h.controllers[0]?.start).toHaveBeenCalledOnce();
    expect(h.disableMain).not.toHaveBeenCalled();
    h.integration.stop();
  });
  it("bounds exhausted startup retries and reports fixed fallback without leaking the error", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.sendMessage.mockRejectedValue(new Error("private transport diagnostic"));
    h.integration.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sendMessage).toHaveBeenCalledTimes(3);
    expect(h.disableMain).toHaveBeenCalledOnce();
    expect(h.controllers).toHaveLength(0);
    expect(document.querySelector("[role=status]")?.textContent).toBe(
      "语见设置暂不可用，已保留原字幕。请重新加载播放器后重试。",
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.sendMessage).toHaveBeenCalledTimes(3);
    h.integration.stop();
    expect(document.querySelector("[role=status]")).toBeNull();
  });
  it.each([
    { ...response, messageVersion: STORE_MESSAGE_VERSION - 1 },
    { ...response, asbplayerMode: "disabled" },
  ])("does not retry protocol or disabled settings into usable state", async (settings) => {
    vi.useFakeTimers();
    const h = fixture();
    h.sendMessage.mockResolvedValueOnce(settings);
    h.integration.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sendMessage).toHaveBeenCalledOnce();
    expect(h.disableMain).toHaveBeenCalledOnce();
    expect(h.controllers).toHaveLength(0);
    h.integration.stop();
  });
  it("cancels retry reads after disable and ignores the old generation after re-enable", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.sendMessage.mockRejectedValueOnce(new Error("transport unavailable"));
    h.integration.start();
    await vi.advanceTimersByTimeAsync(100);
    h.integration.update({ ...policy, enabled: false });
    h.integration.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.controllers).toHaveLength(1);
    expect(document.querySelector("[role=status]")).toBeNull();
    h.integration.stop();
  });
  it("retires pending startup on pagehide and requires authoritative settings on persisted pageshow", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.sendMessage.mockRejectedValueOnce(new Error("transport unavailable"));
    h.integration.start();
    await vi.advanceTimersByTimeAsync(100);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sendMessage).toHaveBeenCalledOnce();
    expect(h.controllers).toHaveLength(0);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(h.controllers).toHaveLength(1);
    expect(h.sendMessage).toHaveBeenCalledTimes(2);
    h.integration.stop();
  });
  it("does not resume a disabled integration after persisted pageshow", async () => {
    const h = fixture();
    h.integration.start();
    await settle();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    h.integration.update({ ...policy, enabled: false });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await settle();
    expect(h.sendMessage).toHaveBeenCalledOnce();
    expect(h.controllers[0]?.stop).toHaveBeenCalledOnce();
  });
});
