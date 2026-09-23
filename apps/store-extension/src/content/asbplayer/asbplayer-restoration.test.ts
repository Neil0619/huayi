import { afterEach, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { ASBPLAYER_ORIGIN } from "./asbplayer-bridge-contract.js";
import { AsbplayerBridgeClient } from "./asbplayer-bridge-client.js";
import { AsbplayerController } from "./asbplayer-controller.js";
import { AsbplayerIntegration } from "./asbplayer-integration.js";
import { installAsbplayerMainBridge } from "./asbplayer-main-bridge.js";
import { adapterHarness, cue } from "./asbplayer.test-support.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("restores both worlds after persisted pageshow using fresh settings, client and complete data", async () => {
  vi.useFakeTimers();
  const first = adapterHarness(),
    second = adapterHarness();
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    window.dispatchEvent(
      new MessageEvent("message", { data, source: window, origin: ASBPLAYER_ORIGIN }),
    );
  });
  const destroy = installAsbplayerMainBridge({
    window,
    createAdapter: vi.fn().mockReturnValueOnce(first.adapter).mockReturnValueOnce(second.adapter),
  });
  cleanup.push(destroy);
  first.port.send({ command: "subtitles", value: [cue({ text: "Early one-shot sentence." })] });
  first.port.send({ command: "offset", value: 0 });
  const player = document.createElement("div"),
    video = document.createElement("video");
  video.currentTime = 1.2;
  player.append(video);
  document.body.append(player);
  const overlay = { close: vi.fn(), relocate: vi.fn() } as never;
  const sendMessage = vi.fn().mockResolvedValue({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/asbplayer-settings-result",
    appearance: "silver",
    asbplayerMode: "english",
    asbplayerShortcut: null,
  });
  const integration = new AsbplayerIntegration({
    document,
    overlay,
    sendMessage,
    isPlayer: () => true,
    createController: () =>
      new AsbplayerController({
        document,
        overlay,
        bridge: new AsbplayerBridgeClient(window),
        media: { video, generation: 1, refresh: () => false, clear: vi.fn() },
        mode: "english",
        appearance: "silver",
      }),
  });
  cleanup.push(() => integration.stop());
  const confirm = () => document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
  integration.start();
  await vi.advanceTimersByTimeAsync(1);
  confirm();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  expect(first.port.close).toHaveBeenCalledOnce();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  expect(document.querySelector("[data-huayi-store-asbplayer]")).toBeNull();
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(
    document.querySelector("[data-bridge-ready=true][data-state=waiting-full-snapshot]"),
  ).not.toBeNull();
  first.port.late({ command: "subtitles", value: [cue({ text: "Stale sentence." })] });
  second.port.send({ command: "subtitlesUpdated", subtitles: [cue({ index: 0 })] });
  confirm();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  second.port.send({ command: "subtitles", value: [cue({ text: "Restored sentence." })] });
  confirm();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  second.port.send({ command: "offset", value: 0 });
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  confirm();
  expect(player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  expect(document.querySelector("[data-huayi-asbplayer-english]")?.textContent).toBe(
    "Restored sentence.",
  );
});
