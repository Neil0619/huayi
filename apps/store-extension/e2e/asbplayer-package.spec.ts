import { expect, test } from "@playwright/test";

import {
  broadcast,
  createAsbplayerPackageFixture,
  cues,
  english,
  learning,
  overlay,
} from "./support/asbplayer-package-fixture.js";

// An actual unpacked Store package, with every HTTP request fulfilled or aborted locally.
test.use({ screenshot: "off", trace: "off" });
test("registered Store worlds complete the local-video learning flow across frames", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page, options, requests } = fixture;
  try {
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("1");
    await frame.locator("[data-confirm-tracks]").click();
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    await expect(frame.locator(".asbplayer-subtitles")).toBeHidden();
    await expect(frame.locator(english)).toHaveText("Learning matters.");
    await frame.locator("#play").click();
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(overlay)).toBeVisible();
    await expect
      .poll(() => frame.locator("video").evaluate((video) => (video as HTMLVideoElement).paused))
      .toBe(true);
    await expect(frame.locator(overlay)).toContainText("常用义");
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toMatch(/blob:|channel|offline-fixture-key|fileName/u);
    await frame.locator(`${overlay} [data-save-word]`).click();
    await expect(frame.locator(overlay)).toContainText("已保存");
    await frame.locator("#fullscreen").click();
    await expect(frame.locator(overlay)).toBeVisible();
    expect(requests).toHaveLength(1);
    await frame.locator("body").evaluate(async () => {
      await document.exitFullscreen();
    });
    await frame.locator("video").click({ position: { x: 700, y: 150 } });
    await expect(frame.locator(overlay)).toHaveCount(0);
    await expect
      .poll(() => frame.locator("video").evaluate((video) => (video as HTMLVideoElement).paused))
      .toBe(false);
    expect(await frame.locator("body").getAttribute("data-toggles")).toBeNull();

    await options.locator('[data-settings-nav="common"]').click();
    await options.locator("[data-asbplayer-mode]").selectOption("bilingual");
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toBeVisible();
    await options.locator("[data-asbplayer-mode]").selectOption("disabled");
    await expect(frame.locator(learning)).toHaveCount(0);
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await options.locator("[data-asbplayer-mode]").selectOption("english");
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-full-snapshot");
    await expect(frame.locator(learning)).toHaveAttribute("data-bridge-ready", "true");
    await broadcast(page, { command: "subtitles", value: cues });
    await broadcast(page, { command: "offset", value: 0 });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await frame.locator("[data-confirm-tracks]").click();
    await expect(frame.locator(learning)).toContainText("未加载中文字幕");

    const pendingPopup = page.waitForEvent("popup");
    await page.locator("#popup").click();
    const popup = await pendingPopup;
    await expect(popup.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await popup.locator("[data-confirm-tracks]").click();
    await expect(popup.locator(learning)).toHaveAttribute("data-state", "usable");
    await popup.close();
  } finally {
    await fixture.close();
  }
});

test("actual Store ordinary selection and YouTube SPA learning stay independent", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  try {
    const article = await fixture.context.newPage();
    await article.goto("https://example.test/");
    await article.locator("p").dblclick({ position: { x: 12, y: 10 } });
    await expect(article.locator(overlay)).toContainText("常用义");
    expect(fixture.requests).toHaveLength(1);
    await article.keyboard.press("Escape");
    await expect(article.locator(overlay)).toHaveCount(0);

    const youtube = await fixture.context.newPage();
    await youtube.goto("https://www.youtube.com/");
    expect(await youtube.locator("[data-huayi-store-youtube-subtitles]").count()).toBe(0);
    await youtube.evaluate((bytes) => {
      const video = document.querySelector("video");
      if (!video) throw new Error("Missing fixture video");
      video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/webm" }));
      history.pushState({}, "", "/watch?v=fixture-video");
      document.dispatchEvent(new Event("yt-navigate-finish"));
    }, fixture.mediaBytes);
    const text = youtube.locator("[data-huayi-store-youtube-english]");
    await expect(text).toHaveText("Learning matters.");
    await youtube.locator("video").evaluate(async (video) => (video as HTMLVideoElement).play());
    await text.dblclick({ position: { x: 12, y: 10 } });
    await expect(youtube.locator(overlay)).toContainText("常用义");
    expect(fixture.requests).toHaveLength(2);
    expect(await youtube.locator(overlay).count()).toBe(1);
    await youtube.keyboard.press("Escape");
    await expect(youtube.locator(overlay)).toHaveCount(0);
    await expect
      .poll(() => youtube.locator("video").evaluate((video) => (video as HTMLVideoElement).paused))
      .toBe(false);
    await youtube.evaluate(() => {
      document.dispatchEvent(new Event("yt-navigate-start"));
      history.pushState({}, "", "/");
      document.dispatchEvent(new Event("yt-navigate-finish"));
    });
    await expect(text).toHaveCount(0);
    await expect(youtube.locator(".ytp-caption-segment")).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("actual Store settings reach every frame and invalid input restores original subtitles", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page, options, requests } = fixture;
  try {
    await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("1");
    await frame.locator("[data-confirm-tracks]").click();
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    await options.locator('[data-settings-nav="common"]').click();
    await options.locator("[data-asbplayer-mode]").selectOption("bilingual");
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toBeVisible();
    for (const offset of [500, 500, -500, 0]) {
      await broadcast(page, { command: "offset", value: offset });
      await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    }
    const pendingPopup = page.waitForEvent("popup");
    await page.locator("#popup").click();
    const popup = await pendingPopup;
    await expect(popup.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await popup.locator("[data-confirm-tracks]").click();
    await expect(popup.locator(learning)).toHaveAttribute("data-state", "usable");
    await options.locator("[data-asbplayer-mode]").selectOption("disabled");
    await expect(frame.locator(learning)).toHaveCount(0);
    await expect(popup.locator(learning)).toHaveCount(0);
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await expect(popup.locator(".asbplayer-subtitles")).toBeVisible();
    await popup.close();
    await options.locator("[data-asbplayer-mode]").selectOption("english");
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-full-snapshot");
    await expect(frame.locator(learning)).toHaveAttribute("data-bridge-ready", "true");
    await broadcast(page, { command: "subtitles", value: cues });
    await broadcast(page, { command: "offset", value: 0 });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await frame.locator("[data-confirm-tracks]").click();
    await expect(frame.locator(learning)).toContainText("未加载中文字幕");
    await broadcast(page, {
      command: "subtitles",
      value: [{ ...cues[0], text: "x".repeat(2001) }],
    });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "invalidated");
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    expect(requests).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test("invalidated Store learning cannot claim its configured Chinese shortcut", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page, options } = fixture;
  try {
    await options.locator('[data-settings-nav="common"]').click();
    const recorder = options.locator("[data-asbplayer-shortcut]");
    await recorder.click();
    await recorder.press("Alt+H");
    await expect(recorder).toHaveText("Alt + H");
    await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("1");
    await frame.locator("[data-confirm-tracks]").click();
    await frame.locator("#play").click();
    await frame.locator("body").evaluate((element) => {
      element.tabIndex = -1;
    });
    await frame.locator("body").focus();
    await page.keyboard.down("Alt");
    await page.keyboard.down("KeyH");
    await expect
      .poll(() => frame.locator("video").evaluate((video) => (video as HTMLVideoElement).paused))
      .toBe(true);
    await page.keyboard.up("KeyH");
    await page.keyboard.up("Alt");
    await expect
      .poll(() => frame.locator("video").evaluate((video) => (video as HTMLVideoElement).paused))
      .toBe(false);
    await frame.locator("video").evaluate((video) => {
      video.dataset.pauseCount = "0";
      video.addEventListener("pause", () => {
        video.dataset.pauseCount = String(Number(video.dataset.pauseCount) + 1);
      });
    });
    await broadcast(page, {
      command: "subtitles",
      value: [{ ...cues[0], text: "x".repeat(2001) }],
    });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "invalidated");
    await page.keyboard.press("Alt+H");
    expect(await frame.locator("video").getAttribute("data-pause-count")).toBe("0");
    expect(
      await frame.locator("video").evaluate((video) => (video as HTMLVideoElement).paused),
    ).toBe(false);
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test("registered worlds retire and restart safely on explicit persisted page lifecycle events", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page } = fixture;
  try {
    await frame.locator("[data-confirm-tracks]").click();
    await frame.locator("#play").click();
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(overlay)).toContainText("常用义");
    await frame.locator("body").evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    await expect(frame.locator(overlay)).toHaveCount(0);
    await expect(frame.locator(learning)).toHaveCount(0);
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await frame.locator("body").evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-full-snapshot");
    await expect(frame.locator(learning)).toHaveAttribute("data-bridge-ready", "true");
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await broadcast(page, { command: "subtitles", value: cues });
    await broadcast(page, { command: "offset", value: 0 });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await frame.locator("[data-confirm-tracks]").click();
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
    expect(fixture.requests).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test("actual Store dragging freezes the sentence and sends one full-selection request", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page, requests } = fixture;
  try {
    await frame.locator("[data-confirm-tracks]").click();
    const block = frame.locator(english);
    const bounds = await block.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Subtitle layout unavailable");
    const text = await block.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = range.getBoundingClientRect(),
        parent = element.getBoundingClientRect();
      return {
        left: box.left - parent.left,
        right: box.right - parent.left,
        y: box.top - parent.top + box.height / 2,
      };
    });
    await page.mouse.move(bounds.x + text.left, bounds.y + text.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + text.right + 2, bounds.y + text.y, { steps: 8 });
    await frame.locator("video").evaluate((video) => {
      (video as HTMLVideoElement).currentTime = 1.8;
    });
    await expect(block).toHaveText("Learning matters.");
    await page.mouse.up();
    await expect(frame.locator(overlay)).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    const request = JSON.parse(requests[0] ?? "{}") as {
      messages: { role: string; content: string }[];
    };
    const content = request.messages.find((message) => message.role === "user")?.content ?? "";
    const data = JSON.parse(content.slice(content.indexOf("\n") + 1)) as Record<string, unknown>;
    expect(data).toMatchObject({
      selection: "Learning matters.",
      selectionKind: "sentence",
      sentenceContext: null,
    });
    expect(await frame.locator(overlay).count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect(frame.locator(english)).toHaveText("Practice helps.");
  } finally {
    await fixture.close();
  }
});
