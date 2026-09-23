import { afterEach, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { AsbplayerIntegration } from "./asbplayer-integration.js";
import { AsbplayerController } from "./asbplayer-controller.js";
import { installAsbplayerMainBridge } from "./asbplayer-main-bridge.js";
import { AsbplayerBridgeClient } from "./asbplayer-bridge-client.js";
import { ASBPLAYER_ORIGIN } from "./asbplayer-bridge-contract.js";
import { adapterHarness, cue } from "./asbplayer.test-support.js";
import { controllerHarness } from "./asbplayer-controller.test-support.js";
import { AsbplayerMediaSession } from "./asbplayer-media-session.js";
import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { TEST_URL } from "./asbplayer.test-support.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanup.splice(0)) clean();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("a transient settings read cannot strand initial startup", async () => {
  vi.useFakeTimers();
  const response = {
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/asbplayer-settings-result",
    appearance: "silver",
    asbplayerMode: "english",
    asbplayerShortcut: null,
  };
  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Service worker startup unavailable"))
    .mockResolvedValue(response);
  const controller = { start: vi.fn(), stop: vi.fn(), setAppearance: vi.fn() };
  const disableMain = vi.fn();
  const integration = new AsbplayerIntegration({
    document,
    overlay: {} as never,
    sendMessage,
    disableMain,
    isPlayer: () => true,
    createController: () => controller,
  });
  cleanup.push(() => integration.stop());
  integration.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(
    controller.start,
    "Startup recovers after one transient settings failure",
  ).toHaveBeenCalledOnce();
});

it("persisted pagehide clears ISOLATED learning state when MAIN retires", () => {
  const h = adapterHarness();
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    window.dispatchEvent(
      new MessageEvent("message", { data, source: window, origin: ASBPLAYER_ORIGIN }),
    );
  });
  const destroyMain = installAsbplayerMainBridge({ window, createAdapter: () => h.adapter });
  cleanup.push(destroyMain);
  const player = document.createElement("div"),
    video = document.createElement("video");
  player.append(video);
  document.body.append(player);
  video.currentTime = 1.2;
  let changed = true;
  const media = {
    video,
    generation: 1,
    refresh: () => {
      const result = changed;
      changed = false;
      return result;
    },
    clear: vi.fn(),
  };
  const client = new AsbplayerBridgeClient(window);
  const controller = new AsbplayerController({
    document,
    bridge: client,
    mode: "english",
    appearance: "silver",
    media,
    overlay: { close: vi.fn(), relocate: vi.fn() } as never,
  });
  cleanup.push(() => controller.stop());
  controller.start();
  h.port.send({ command: "subtitles", value: [cue({ text: "Before navigation." })] });
  h.port.send({ command: "offset", value: 0 });
  document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  expect(h.port.close).toHaveBeenCalledOnce();
  expect(
    player.hasAttribute("data-huayi-asbplayer-active"),
    "The retired document restores native subtitles",
  ).toBe(false);
});

it("changing playback context blocks old subtitles before the next MAIN poll", () => {
  vi.useFakeTimers();
  const h = adapterHarness();
  let url = TEST_URL;
  const player = document.createElement("div"),
    video = document.createElement("video");
  player.className = "asbplayer-token-container";
  video.preload = "auto";
  video.src = parseAsbplayerPlaybackContext(url, "top-level")?.mediaUrl ?? "";
  video.currentTime = 1.2;
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    width: 500,
    height: 300,
    top: 0,
    bottom: 300,
    left: 0,
    right: 500,
  } as DOMRect);
  player.append(video);
  document.body.append(player);
  const media = new AsbplayerMediaSession(document, () =>
    parseAsbplayerPlaybackContext(url, "top-level"),
  );
  const controller = new AsbplayerController({
    document,
    bridge: { subscribe: h.adapter.subscribe, start: vi.fn(), destroy: h.adapter.dispose },
    mode: "english",
    appearance: "silver",
    media,
    overlay: { close: vi.fn(), relocate: vi.fn() } as never,
  });
  cleanup.push(() => controller.stop());
  controller.start();
  h.port.send({ command: "subtitles", value: [cue({ text: "Old media sentence." })] });
  h.port.send({ command: "offset", value: 0 });
  document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  url = TEST_URL.replace("7fe82f76", "8fe82f76").replace("test-channel", "other-channel");
  video.src = parseAsbplayerPlaybackContext(url, "top-level")?.mediaUrl ?? "";
  h.navigate(url);
  vi.advanceTimersByTime(100);
  document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
  expect(
    player.hasAttribute("data-huayi-asbplayer-active"),
    "Old media data cannot confirm a new playback context",
  ).toBe(false);
});

it("an invalidated learning layer cannot capture the Chinese hold shortcut", () => {
  const h = controllerHarness();
  cleanup.push(() => h.controller.stop());
  h.video.currentTime = 1.2;
  let paused = false;
  Object.defineProperty(h.video, "paused", { get: () => paused, configurable: true });
  const pause = vi.spyOn(h.video, "pause").mockImplementation(() => {
    paused = true;
    h.video.dispatchEvent(new Event("pause"));
  });
  h.controller.start();
  h.snapshot();
  h.port.send({ command: "offset", value: 0 });
  h.port.send({ command: "playModes", playModes: [1] });
  h.confirm();
  h.controller.updatePreferences({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/asbplayer-settings-result",
    appearance: "silver",
    asbplayerMode: "english",
    asbplayerShortcut: { code: "KeyH", ctrl: false, alt: true, shift: false, meta: false },
  });
  h.port.send({ command: "subtitles", value: [cue({ text: "x".repeat(2001) })] });
  expect(document.querySelector("[data-huayi-store-asbplayer]")?.getAttribute("data-state")).toBe(
    "invalidated",
  );
  const key = new KeyboardEvent("keydown", {
    code: "KeyH",
    key: "h",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(key);
  expect(pause, "Fallback cannot capture the learning shortcut").not.toHaveBeenCalled();
});
