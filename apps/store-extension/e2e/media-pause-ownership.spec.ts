import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { MediaPauseOwnership } from "../src/content/subtitles/media-pause-ownership.js";

let source: string;
let media: string;

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(
          new URL("../src/content/subtitles/media-pause-ownership.ts", import.meta.url),
        ),
        formats: ["iife"],
        name: "PauseOwnershipFixture",
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !("output" in output)) throw new Error("Expected one bundle.");
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing pause ownership bundle.");
  source = chunk.code;
  media = (await readFile(new URL("fixtures/asbplayer-learning.webm", import.meta.url))).toString(
    "base64",
  );
});

for (const userIntervenes of [false, true]) {
  test(
    userIntervenes
      ? "a queued user play/pause still prevents owned playback recovery"
      : "an owned pause resumes despite a preceding queued native play event",
    async ({ page }) => {
      await page.setContent("<video muted loop></video>");
      await page.addScriptTag({ content: source });
      const result = await page.evaluate(
        async ({ media, userIntervenes }) => {
          const video = document.querySelector("video");
          if (!video) throw new Error("Missing fixture video.");
          const loaded = new Promise<void>((resolve) =>
            video.addEventListener("loadeddata", () => resolve(), { once: true }),
          );
          video.src = `data:video/webm;base64,${media}`;
          await loaded;
          const fixture = window as typeof window & {
            PauseOwnershipFixture: { MediaPauseOwnership: typeof MediaPauseOwnership };
          };
          const owner = new fixture.PauseOwnershipFixture.MediaPauseOwnership(
            () => ({ video, generation: 1 }),
            () => [1],
          );
          owner.bind();
          const events: { type: string; paused: boolean; trusted: boolean }[] = [];
          const delivered = new Promise<void>((resolve) => {
            let pauses = 0;
            for (const type of ["play", "pause"])
              video.addEventListener(type, (event) => {
                events.push({ type, paused: video.paused, trusted: event.isTrusted });
                if (type === "pause" && ++pauses === (userIntervenes ? 2 : 1)) resolve();
              });
          });
          // Both calls change paused synchronously; native media events are queued.
          void video.play().catch(() => undefined);
          owner.acquire("hold");
          if (userIntervenes) {
            void video.play().catch(() => undefined);
            video.pause();
          }
          await delivered;
          const atRelease = events.slice();
          owner.release("hold");
          const paused = video.paused;
          const time = video.currentTime;
          owner.destroy();
          return { events: atRelease, paused, time };
        },
        { media, userIntervenes },
      );
      expect(result.events).toEqual(
        (userIntervenes ? ["play", "pause", "play", "pause"] : ["play", "pause"]).map((type) => ({
          type,
          paused: true,
          trusted: true,
        })),
      );
      expect(result.paused).toBe(userIntervenes);
      if (!userIntervenes)
        await expect
          .poll(() => page.locator("video").evaluate((video) => video.currentTime))
          .toBeGreaterThan(result.time);
    },
  );
}
