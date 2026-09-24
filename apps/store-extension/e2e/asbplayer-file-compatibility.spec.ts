import { expect, test } from "@playwright/test";
import {
  broadcast,
  createAsbplayerPackageFixture,
  cues,
  english,
  learning,
  overlay,
} from "./support/asbplayer-package-fixture.js";

test.use({ screenshot: "off", trace: "off" });

test("actual Store preserves native credits and learns from the rest of a bilingual file", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page } = fixture;
  try {
    await broadcast(page, {
      command: "subtitles",
      value: [
        { ...cues[0], originalEnd: 500, text: "字幕制作：Example 小组" },
        {
          ...cues[0],
          originalStart: 500,
          originalEnd: 3000,
          text: "Learning uses Wi-Fi.\n学习使用 Wi-Fi。",
        },
        { ...cues[0], originalStart: 1000, originalEnd: 1500, text: "■" },
      ],
    });
    await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("0");
    await frame.locator("[data-confirm-tracks]").click();
    const video = frame.locator("video");
    const seek = async (time: number) => {
      await video.evaluate((element: HTMLVideoElement, target) => {
        element.pause();
        element.currentTime = target;
      }, time);
    };
    await seek(0.2);
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "native-subtitles");
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await seek(0.7);
    await expect(frame.locator(english)).toHaveText("Learning uses Wi-Fi.");
    await expect(frame.locator(".asbplayer-subtitles")).toBeHidden();
    await frame.getByRole("button", { name: "固定中文", exact: true }).click();
    await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toHaveText("学习使用 Wi-Fi。");
    await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toBeVisible();
    await seek(1.2);
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "native-subtitles");
    await seek(1.7);
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    await expect(frame.locator(".asbplayer-subtitles")).toBeHidden();
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(`${overlay} [data-result-type="translate-word"]`)).toBeVisible();
    await expect(frame.locator(`${overlay} [data-stop]`)).toBeHidden();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true);
    await frame.locator(`${overlay} [data-action=explain]`).click();
    await expect(frame.locator(`${overlay} [data-result-type="explain-word"]`)).toBeVisible();
    await expect(frame.locator(`${overlay} [data-stop]`)).toBeHidden();
    await frame.locator(`${overlay} [data-save-word]`).click();
    await expect(frame.locator(overlay)).toContainText("已保存");
    await page.keyboard.press("Escape");
    await expect(frame.locator(overlay)).toHaveCount(0);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(false);
    expect(fixture.requests).toHaveLength(2);
  } finally {
    await fixture.close();
  }
});

test("actual Store explains an empty subtitle and accepts a later complete file", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  try {
    await broadcast(fixture.page, { command: "subtitles", value: [] });
    await expect(fixture.frame.locator(learning)).toHaveAttribute(
      "data-state",
      "waiting-full-snapshot",
    );
    await expect(fixture.frame.locator(learning)).toContainText("未读取到字幕文本");
    await expect(fixture.frame.getByRole("combobox", { name: "英语轨道" })).toBeHidden();
    await expect(fixture.frame.locator(".asbplayer-subtitles")).toBeVisible();
    await broadcast(fixture.page, { command: "subtitles", value: cues });
    await expect(fixture.frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await fixture.frame.locator("[data-confirm-tracks]").click();
    await expect(fixture.frame.locator(english)).toHaveText("Learning matters.");
  } finally {
    await fixture.close();
  }
});
