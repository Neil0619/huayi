import { afterEach, describe, expect, it } from "vitest";
import { controllerHarness } from "./asbplayer-controller.test-support.js";
import { cue } from "./asbplayer.test-support.js";

afterEach(() => document.body.replaceChildren());
describe("track selection defaults", () => {
  it("preselects the same bilingual track without requiring the Chinese dropdown every episode", () => {
    const h = controllerHarness();
    h.controller.start();
    try {
      h.port.send({
        command: "subtitles",
        value: [cue({ text: "字幕制作说明" }), cue({ text: "Learning matters.\n学习很重要。" })],
      });
      h.port.send({ command: "offset", value: 0 });
      const zh = document.querySelector<HTMLSelectElement>('select[aria-label="中文轨道"]');
      expect(zh?.value).toBe("0");
      expect(
        document.querySelector("[data-huayi-store-asbplayer]")?.getAttribute("data-state"),
      ).toBe("waiting-tracks");
      document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
      expect(
        document.querySelector("[data-huayi-store-asbplayer]")?.getAttribute("data-state"),
      ).toBe("usable");
    } finally {
      h.controller.stop();
    }
  });
  it("preselects a unique Chinese track and does not reuse its numeric index for a different episode", () => {
    const h = controllerHarness();
    h.controller.start();
    try {
      h.snapshot();
      h.port.send({ command: "offset", value: 0 });
      const zh = document.querySelector<HTMLSelectElement>('select[aria-label="中文轨道"]');
      expect(zh?.value).toBe("1");
      h.port.send({ command: "subtitles", value: [cue({ text: "Only English." })] });
      expect(zh?.value).toBe("none");
    } finally {
      h.controller.stop();
    }
  });
  it("leaves ambiguous Chinese choices for the user", () => {
    const h = controllerHarness();
    h.controller.start();
    try {
      h.port.send({
        command: "subtitles",
        value: [
          cue({ text: "English." }),
          cue({ track: 1, text: "中文一。" }),
          cue({ track: 2, text: "中文二。" }),
        ],
      });
      h.port.send({ command: "offset", value: 0 });
      expect(
        document.querySelector<HTMLSelectElement>('select[aria-label="中文轨道"]')?.value,
      ).toBe("none");
    } finally {
      h.controller.stop();
    }
  });
  it("reconsiders full content when a new snapshot has the same first-line preview", () => {
    const h = controllerHarness();
    h.controller.start();
    try {
      h.port.send({ command: "subtitles", value: [cue({ text: "Opening." })] });
      h.port.send({ command: "offset", value: 0 });
      const zh = document.querySelector<HTMLSelectElement>('select[aria-label="中文轨道"]');
      expect(zh?.value).toBe("none");
      h.port.send({
        command: "subtitles",
        value: [
          cue({ text: "Opening." }),
          cue({ text: "Welcome.\n欢迎。", originalStart: 1500, originalEnd: 3000 }),
        ],
      });
      expect(zh?.value).toBe("0");
    } finally {
      h.controller.stop();
    }
  });
});
