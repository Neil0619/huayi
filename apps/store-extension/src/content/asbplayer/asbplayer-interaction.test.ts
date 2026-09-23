import { afterEach, describe, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { setup } from "../overlay/store-overlay-controller.test-support.js";
import { StoreContentApp } from "../store-content-app.js";
import { controllerHarness } from "./asbplayer-controller.test-support.js";
import { cue } from "./asbplayer.test-support.js";
const stops: (() => void)[] = [];
function pointer(type: string) {
  const event = new MouseEvent(type, { bubbles: true, composed: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: 7 });
  return event;
}
function holdKey(type: "keydown" | "keyup") {
  const event = new KeyboardEvent(type, {
    code: "KeyH",
    key: "h",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
}
function shortcut(h: ReturnType<typeof fixture>) {
  h.controller.updatePreferences({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/asbplayer-settings-result",
    appearance: "silver",
    asbplayerMode: "english",
    asbplayerShortcut: { code: "KeyH", ctrl: false, alt: true, shift: false, meta: false },
  });
}
function fixture() {
  vi.useFakeTimers();
  const { controller: overlay, ports } = setup();
  const h = controllerHarness(overlay);
  let paused = false;
  Object.defineProperty(h.video, "paused", { get: () => paused, configurable: true });
  vi.spyOn(h.video, "pause").mockImplementation(() => {
    paused = true;
    h.video.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(h.video, "play").mockImplementation(async () => {
    paused = false;
    h.video.dispatchEvent(new Event("play"));
  });
  h.video.currentTime = 1.2;
  h.controller.start();
  h.snapshot();
  h.port.send({ command: "offset", value: 0 });
  h.port.send({ command: "playModes", playModes: [1] });
  h.confirm();
  const generic = new StoreContentApp(document, overlay, () => true);
  generic.start();
  stops.push(() => {
    generic.stop();
    h.controller.stop();
  });
  function block() {
    const block = document.querySelector<HTMLElement>("[data-huayi-asbplayer-english]");
    if (!block) throw new Error("Missing caption");
    return block;
  }
  function select(drag = false) {
    const element = block();
    if (drag) element.dispatchEvent(pointer("pointerdown"));
    const text = element.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 120, left: 50, right: 90 }),
    });
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return element;
  }
  return { ...h, overlay, ports, block, select };
}
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});
describe("asbplayer selection and media interaction M2", () => {
  it("freezes text through drag/timechange and opens one card on outside release", async () => {
    const h = fixture();
    const show = vi.spyOn(h.overlay, "show");
    const block = h.select(true);
    h.video.currentTime = 8;
    vi.advanceTimersByTime(200);
    expect(h.block()).toBe(block);
    expect(block.textContent).toBe("This is a complete sentence.");
    document.body.dispatchEvent(pointer("pointerup"));
    await Promise.resolve();
    expect(show).toHaveBeenCalledOnce();
    expect(h.video.pause).toHaveBeenCalledOnce();
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(show).toHaveBeenCalledOnce();
    expect(h.overlay.getHost()).not.toBeNull();
  });
  it("consumes both blank dismissal events without racing the generic overlay listener", () => {
    const h = fixture();
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const toggle = vi.fn();
    h.video.addEventListener("click", toggle);
    const down = pointer("pointerdown"),
      click = pointer("click");
    h.video.dispatchEvent(down);
    h.video.dispatchEvent(click);
    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
    expect(h.video.play).toHaveBeenCalledOnce();
    expect(h.overlay.getHost()).toBeNull();
  });
  it("transfers temporary hold to selection; user seek revokes automatic resume", () => {
    const h = fixture();
    const hold = document.querySelector<HTMLButtonElement>(
      "[data-huayi-store-asbplayer-control] button:nth-of-type(2)",
    );
    hold?.dispatchEvent(pointer("pointerdown"));
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    hold?.dispatchEvent(pointer("pointerup"));
    expect(h.video.pause).toHaveBeenCalledOnce();
    expect(h.video.play).not.toHaveBeenCalled();
    h.video.dispatchEvent(new Event("seeking"));
    h.overlay.close();
    expect(h.video.play).not.toHaveBeenCalled();
  });
  it("keeps one live card and request when its fullscreen mount changes", () => {
    const h = fixture();
    h.overlay.setDefaultAction("explain");
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const host = h.overlay.getHost();
    expect(h.ports).toHaveLength(1);
    const fullscreen = document.createElement("div");
    document.body.append(fullscreen);
    fullscreen.append(h.player);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreen });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(h.overlay.getHost()).toBe(host);
    expect(host?.parentElement).toBe(fullscreen);
    expect(h.ports).toHaveLength(1);
    expect(h.ports[0]?.disconnect).not.toHaveBeenCalled();
  });
  it("keeps the card and owned pause through the fullscreen button pointer/click sequence", () => {
    const h = fixture();
    h.overlay.setDefaultAction("explain");
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const host = h.overlay.getHost();
    const button = document.createElement("button");
    button.ariaLabel = "全屏";
    h.player.append(button);
    button.addEventListener("click", () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: h.player });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    button.dispatchEvent(pointer("pointerdown"));
    button.dispatchEvent(pointer("click"));
    expect(h.overlay.getHost()).toBe(host);
    expect(h.ports).toHaveLength(1);
    expect(h.video.play).not.toHaveBeenCalled();
    h.video.dispatchEvent(pointer("pointerdown"));
    h.video.dispatchEvent(pointer("click"));
    expect(h.video.play).toHaveBeenCalledOnce();
  });
  it("keeps tracks and selected sentence while mode/shortcut update live", () => {
    const h = fixture();
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const host = h.overlay.getHost();
    h.controller.updatePreferences({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/asbplayer-settings-result",
      appearance: "moon",
      asbplayerMode: "english",
      asbplayerShortcut: { code: "KeyH", ctrl: false, alt: true, shift: false, meta: false },
    });
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    expect(h.overlay.getHost()).toBe(host);
    expect(
      document.querySelector("[data-huayi-store-asbplayer]")?.getAttribute("data-appearance"),
    ).toBe("moon");
  });
  it("invalidates a pending selection callback when tracks change", async () => {
    const h = fixture();
    const show = vi.spyOn(h.overlay, "show");
    h.select(true);
    document.body.dispatchEvent(pointer("pointerup"));
    h.port.send({ command: "subtitles", value: [cue({ text: "New sentence." })] });
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
    expect(h.video.pause).not.toHaveBeenCalled();
  });
  it("invalidating a held layer revokes ownership, rejects hidden gestures and cannot revive old keyup", async () => {
    const h = fixture();
    const show = vi.spyOn(h.overlay, "show");
    shortcut(h);
    holdKey("keydown");
    expect(h.video.pause).toHaveBeenCalledOnce();
    const block = h.select();
    h.port.send({ command: "subtitles", value: [cue({ text: "x".repeat(2001) })] });
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    expect(holdKey("keydown").defaultPrevented).toBe(false);
    block.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
    h.snapshot();
    h.port.send({ command: "offset", value: 0 });
    h.port.send({ command: "playModes", playModes: [1] });
    h.confirm();
    holdKey("keyup");
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.video.pause).toHaveBeenCalledOnce();
  });
  it("pagehide closes the card, cancels pending gestures and revokes owned pause", async () => {
    const h = fixture();
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(h.overlay.getHost()).not.toBeNull();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(h.overlay.getHost()).toBeNull();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    expect(h.video.play).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(document.querySelector("[data-huayi-store-asbplayer]")).toBeNull();
  });
  it("rejects stale selection before the media polling timer runs", () => {
    const h = fixture();
    const show = vi.spyOn(h.overlay, "show");
    const block = h.select();
    h.changed();
    block.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(show).not.toHaveBeenCalled();
    expect(h.video.pause).not.toHaveBeenCalled();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  });
  it.each(["keyup", "blur", "pointerup"])(
    "does not resume changed media from a stale hold %s",
    (release) => {
      const h = fixture();
      shortcut(h);
      const button = document.querySelector<HTMLButtonElement>(
        "[data-huayi-store-asbplayer-control] button:nth-of-type(2)",
      );
      if (release === "pointerup") button?.dispatchEvent(pointer("pointerdown"));
      else holdKey("keydown");
      expect(h.video.pause).toHaveBeenCalledOnce();
      h.changed();
      if (release === "pointerup") button?.dispatchEvent(pointer("pointerup"));
      else if (release === "blur") window.dispatchEvent(new Event("blur"));
      else holdKey("keyup");
      expect(h.video.play).not.toHaveBeenCalled();
      expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    },
  );
  it("does not resume changed media through an old card-close callback before polling", () => {
    const h = fixture();
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    h.changed();
    h.overlay.close();
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  });
  it("native-video fullscreen clears card and hold ownership and does not revive it on exit", () => {
    const h = fixture();
    h.select().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: h.video });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(h.overlay.getHost()).toBeNull();
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    expect(h.video.play).not.toHaveBeenCalled();
  });
  it("crowded cue fallback clears hold ownership and gates hidden controls", () => {
    const h = fixture();
    shortcut(h);
    h.port.send({
      command: "subtitles",
      value: [
        cue({ text: "Current sentence." }),
        cue({ track: 1, text: "当前句子。" }),
        ...Array.from({ length: 65 }, () =>
          cue({ originalStart: 3000, originalEnd: 4000, text: "Overlapping sentence." }),
        ),
      ],
    });
    h.confirm();
    holdKey("keydown");
    h.video.currentTime = 3.2;
    vi.advanceTimersByTime(100);
    expect(document.querySelector("[data-state=invalidated]")).not.toBeNull();
    expect(holdKey("keydown").defaultPrevented).toBe(false);
    holdKey("keyup");
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.video.pause).toHaveBeenCalledOnce();
  });
  it("losing a usable mount revokes hold ownership until the same media becomes visible", () => {
    const h = fixture();
    shortcut(h);
    holdKey("keydown");
    h.media.video = null;
    vi.advanceTimersByTime(100);
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
    expect(holdKey("keydown").defaultPrevented).toBe(false);
    h.media.video = h.video;
    vi.advanceTimersByTime(100);
    holdKey("keyup");
    expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    expect(h.video.play).not.toHaveBeenCalled();
  });
});
