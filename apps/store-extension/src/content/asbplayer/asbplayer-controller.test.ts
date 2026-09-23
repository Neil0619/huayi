import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controllerHarness } from "./asbplayer-controller.test-support.js";
import { cue } from "./asbplayer.test-support.js";
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
describe("asbplayer learning controller M1", () => {
  it("waits for full data, known offset and user confirmation before hiding native subtitles", () => {
    const h = controllerHarness();
    h.controller.start();
    h.snapshot();
    expect(document.querySelector("[data-state=waiting-full-snapshot]")).not.toBeNull();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    h.port.send({ command: "offset", value: 0 });
    expect(document.querySelector("[data-state=waiting-tracks]")).not.toBeNull();
    h.confirm();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    h.controller.stop();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  });
  it("invalidates track confirmation on edits but preserves it for pure offset changes", () => {
    const h = controllerHarness();
    h.controller.start();
    h.snapshot();
    h.port.send({ command: "offset", value: 0 });
    h.confirm();
    h.port.send({
      command: "subtitlesUpdated",
      subtitles: [cue({ index: 0, text: "Updated sentence." })],
    });
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    h.confirm();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    h.port.send({ command: "offset", value: 1500 });
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    h.port.send({ command: "offset", value: -500 });
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    h.controller.stop();
  });
  it("aligns Chinese by interval overlap and visibly reports missing Chinese in English mode", () => {
    const h = controllerHarness();
    h.video.currentTime = 1.2;
    h.controller.start();
    h.port.send({
      command: "subtitles",
      value: [
        cue({ text: "A complete sentence." }),
        cue({ track: 1, originalStart: 9000, originalEnd: 10000, text: "无关字幕" }),
        cue({ track: 1, originalStart: 900, originalEnd: 1500, text: "对应字幕一" }),
        cue({ track: 1, originalStart: 1500, originalEnd: 2500, text: "对应字幕二" }),
      ],
    });
    h.port.send({ command: "offset", value: 0 });
    h.confirm();
    expect(document.querySelector("[data-huayi-asbplayer-chinese]")?.textContent).toBe(
      "对应字幕一 对应字幕二",
    );
    const reset = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "更换轨道",
    );
    reset?.click();
    const selects = document.querySelectorAll("select");
    if (selects[1]) selects[1].value = "none";
    document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
    h.controller.updatePreferences({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/asbplayer-settings-result",
      appearance: "silver",
      asbplayerMode: "english",
      asbplayerShortcut: null,
    });
    const unavailable = [...document.querySelectorAll("span")].find(
      (span) => span.textContent === "未加载中文字幕",
    );
    expect(unavailable?.hidden).toBe(false);
    expect(unavailable?.parentElement?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-huayi-asbplayer-chinese]")?.hidden).toBe(
      true,
    );
    h.controller.stop();
  });
  it("preserves source confirmation on offset changes but clears in-flight selection ownership", () => {
    const h = controllerHarness();
    h.controller.start();
    h.snapshot();
    h.port.send({ command: "offset", value: 0 });
    h.confirm();
    h.port.send({ command: "offset", value: 500 });
    expect(h.overlay.close).toHaveBeenLastCalledWith("owner-clear");
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    h.controller.stop();
  });
  it("keeps the native view for excessive overlap instead of rendering an unbounded learning surface", () => {
    const h = controllerHarness();
    h.video.currentTime = 1.2;
    h.controller.start();
    h.port.send({
      command: "subtitles",
      value: Array.from({ length: 65 }, () => cue({ text: "An overlapping sentence." })),
    });
    h.port.send({ command: "offset", value: 0 });
    document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    expect(document.querySelector("[data-state=invalidated]")?.textContent).toContain(
      "同一时段字幕过多",
    );
    h.controller.stop();
  });
  it("retains the confirmation across container fullscreen but restores native video fullscreen", () => {
    const h = controllerHarness();
    h.controller.start();
    h.snapshot();
    h.port.send({ command: "offset", value: 0 });
    h.confirm();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: h.video });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: h.player });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    h.controller.stop();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });
});
