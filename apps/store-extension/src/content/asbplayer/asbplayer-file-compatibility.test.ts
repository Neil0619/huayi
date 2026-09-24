import { afterEach, describe, expect, it, vi } from "vitest";
import { controllerHarness } from "./asbplayer-controller.test-support.js";
import { cue } from "./asbplayer.test-support.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("asbplayer real-file compatibility", () => {
  it("restores native subtitles only during ambiguous cues and recovers without reconfirmation", () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    h.controller.start();
    h.port.send({
      command: "subtitles",
      value: [
        cue({ originalStart: 0, originalEnd: 1000, text: "字幕制作：Example 小组" }),
        cue({ originalStart: 1000, originalEnd: 5000, text: "Use Wi-Fi.\n使用 Wi-Fi。" }),
        cue({ originalStart: 2000, originalEnd: 3000, text: "■" }),
      ],
    });
    h.port.send({ command: "offset", value: 0 });
    const chinese = document.querySelector<HTMLSelectElement>('[aria-label="中文轨道"]');
    if (chinese) chinese.value = "0";
    document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
    const active = () => h.player.hasAttribute("data-huayi-asbplayer-active");
    const status = () =>
      document.querySelector("[data-huayi-store-asbplayer]")?.getAttribute("data-state");
    try {
      expect(active()).toBe(false);
      expect(status()).toBe("native-subtitles");
      h.video.currentTime = 1.2;
      vi.advanceTimersByTime(100);
      expect(active()).toBe(true);
      expect(document.querySelector("[data-huayi-asbplayer-english]")?.textContent).toBe(
        "Use Wi-Fi.",
      );
      expect(document.querySelector("[data-huayi-asbplayer-chinese]")?.textContent).toBe(
        "使用 Wi-Fi。",
      );
      h.video.currentTime = 2.2;
      vi.advanceTimersByTime(100);
      expect(active()).toBe(false);
      expect(status()).toBe("native-subtitles");
      h.video.currentTime = 3.2;
      vi.advanceTimersByTime(100);
      expect(active()).toBe(true);
      expect(status()).toBe("usable");
      h.port.send({ command: "offset", value: 1500 });
      h.video.currentTime = 3.7;
      vi.advanceTimersByTime(100);
      expect(active()).toBe(false);
      expect(status()).toBe("native-subtitles");
      h.video.currentTime = 4.7;
      vi.advanceTimersByTime(100);
      expect(active()).toBe(true);
    } finally {
      h.controller.stop();
    }
  });

  it("explains an empty parsed subtitle instead of showing an empty track selector", () => {
    const h = controllerHarness();
    h.controller.start();
    h.port.send({ command: "subtitles", value: [] });
    h.port.send({ command: "offset", value: 0 });
    try {
      const status = document.querySelector("[data-huayi-store-asbplayer]");
      expect(status?.getAttribute("data-state")).toBe("waiting-full-snapshot");
      expect(status?.textContent).toContain("未读取到字幕文本");
      expect(status?.textContent).toContain("较短路径");
      expect(
        document.querySelector<HTMLSelectElement>('[aria-label="英语轨道"]')?.closest("[hidden]"),
      ).not.toBeNull();
      expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
      h.snapshot();
      h.confirm();
      expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
    } finally {
      h.controller.stop();
    }
  });
});
