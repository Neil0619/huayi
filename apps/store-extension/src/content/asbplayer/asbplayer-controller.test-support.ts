import { vi } from "vitest";
import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { AsbplayerController } from "./asbplayer-controller.js";
import { adapterHarness, cue } from "./asbplayer.test-support.js";
export function controllerHarness(overlayOverride?: StoreOverlayController) {
  const adapter = adapterHarness();
  const player = document.createElement("div");
  player.className = "asbplayer-token-container";
  const video = document.createElement("video");
  const native = document.createElement("div");
  native.className = "asbplayer-subtitles";
  native.textContent = "native";
  player.append(video, native);
  document.body.append(player);
  let changed = true;
  const media = {
    video: video as HTMLVideoElement | null,
    generation: 1,
    refresh: () => {
      const result = changed;
      changed = false;
      return result;
    },
    clear: vi.fn(),
  };
  const overlay = { close: vi.fn(), show: vi.fn(), relocate: vi.fn(), getHost: () => null };
  const controller = new AsbplayerController({
    document,
    bridge: {
      subscribe: adapter.adapter.subscribe,
      start: vi.fn(),
      destroy: adapter.adapter.dispose,
    },
    mode: "bilingual",
    appearance: "silver",
    media,
    overlay: overlayOverride ?? (overlay as unknown as StoreOverlayController),
    acceptsUserGesture: () => true,
  });
  const snapshot = () =>
    adapter.port.send({
      command: "subtitles",
      value: [
        cue({ text: "This is a complete sentence." }),
        cue({ track: 1, text: "这是完整句子。" }),
      ],
    });
  function confirm() {
    const selects = document.querySelectorAll("select");
    if (selects[1]) selects[1].value = "1";
    document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
  }
  return {
    ...adapter,
    controller,
    player,
    video,
    media,
    overlay,
    snapshot,
    confirm,
    changed: () => {
      changed = true;
      media.generation += 1;
    },
  };
}
