import { afterEach, describe, expect, it, vi } from "vitest";

import { YouTubeCaptionView } from "./youtube-caption-view.js";

afterEach(() => {
  document.body.textContent = "";
});

describe("Store YouTube caption view", () => {
  it("updates both caption and control appearance markers without rebuilding the view", () => {
    const player = document.createElement("div");
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    player.append(cc);
    document.body.append(player);
    const view = new YouTubeCaptionView(
      document,
      player,
      false,
      () => undefined,
      () => undefined,
      "",
      "moon",
    );
    const caption = player.querySelector<HTMLElement>("[data-huayi-store-youtube-subtitles]");
    const control = player.querySelector<HTMLElement>("[data-huayi-store-youtube-control-host]");
    const styles = player.querySelector("style")?.textContent ?? "";

    expect(caption?.dataset.appearance).toBe("moon");
    expect(control?.dataset.appearance).toBe("moon");
    expect(styles).toContain("#huayi-y[data-appearance=moon]");
    expect(styles).toContain("#huayi-yc[data-appearance=porcelain]");
    expect(styles).not.toContain("#67e8f9");
    view.setAppearance("champagne");
    expect(player.querySelector("[data-huayi-store-youtube-subtitles]")).toBe(caption);
    expect(caption?.dataset.appearance).toBe("champagne");
    expect(control?.dataset.appearance).toBe("champagne");
    view.destroy();
  });

  it("keeps all pointer and mouse events for both 中 controls inside the Huayi boundary", () => {
    const player = document.createElement("div");
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    player.append(cc);
    document.body.append(player);
    const view = new YouTubeCaptionView(document, player, false, () => undefined);
    view.render(
      { endMs: 4_000, startMs: 0, text: "The investigation continues." },
      "调查仍在继续。",
      true,
    );
    const temporary = player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );
    const fixed = player.querySelector<HTMLButtonElement>("[data-huayi-store-youtube-bilingual]");
    const playerEvents: string[] = [];
    const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"];
    for (const type of eventTypes) player.addEventListener(type, () => playerEvents.push(type));

    expect(temporary).not.toBeNull();
    expect(fixed).not.toBeNull();
    for (const button of [temporary, fixed]) {
      for (const type of eventTypes) {
        button?.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
        );
      }
    }

    expect(playerEvents).toEqual([]);
    view.destroy();
  });

  it("keeps rapid bilingual pointer clicks inside the caption control", () => {
    const player = document.createElement("div");
    const video = document.createElement("video");
    let paused = false;
    const pause = vi.fn(() => {
      paused = true;
    });
    const play = vi.fn(async () => {
      paused = false;
    });
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => paused },
      pause: { configurable: true, value: pause },
      play: { configurable: true, value: play },
    });
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    player.append(video, cc);
    document.body.append(player);
    const sentence = { endMs: 4_000, startMs: 0, text: "The investigation continues." };
    const translated = "调查仍在继续。";
    const view = new YouTubeCaptionView(document, player, true, () => {
      view.toggleBilingual();
      view.render(sentence, translated, true);
    });
    view.render(sentence, translated, true);
    const toggle = player.querySelector<HTMLButtonElement>("[data-huayi-store-youtube-bilingual]");
    if (toggle === null) throw new Error("Expected the bilingual toggle.");
    const playerEvents: string[] = [];
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"]) {
      player.addEventListener(type, () => playerEvents.push(type));
    }
    player.addEventListener("click", () => {
      if (video.paused) void video.play();
      else video.pause();
    });
    const activate = () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        toggle.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
        );
      }
    };

    activate();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    activate();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    toggle.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true }),
    );
    activate();

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(playerEvents).toEqual([]);
    expect(pause).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(video.paused).toBe(false);
    view.destroy();
  });

  it("does not retrigger the lifecycle observer when stable state is rendered", async () => {
    const player = document.createElement("div");
    document.body.append(player);
    const view = new YouTubeCaptionView(document, player, true, () => undefined);
    const sentence = {
      endMs: 4_000,
      startMs: 0,
      text: "The investigation was still in its early stages.",
    };
    view.render(sentence, "调查仍处于早期阶段。", true);
    await Promise.resolve();

    const attributeNames: string[] = [];
    let callbackCount = 0;
    const observer = new MutationObserver((records) => {
      attributeNames.push(...records.map((record) => record.attributeName ?? record.type));
      callbackCount += 1;
      if (callbackCount >= 4) {
        observer.disconnect();
        return;
      }
      view.render(sentence, "调查仍处于早期阶段。", true);
    });
    observer.observe(player, {
      attributeFilter: ["aria-pressed", "class"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    player.classList.add("ytp-autohide");
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();

    expect(attributeNames).toEqual(["class"]);
    expect(callbackCount).toBe(1);
    view.destroy();
  });
});
