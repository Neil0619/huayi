import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMedia } from "./asbplayer-media.mjs";

const corruptions = {
  "empty manifest file list": (cache) => (cache.files = []),
  "missing video": (cache) => cache.files.shift(),
  "missing extracted subtitle": (cache) => cache.files.pop(),
  "duplicate video": (cache) => (cache.files[1] = cache.files[0]),
  "incorrect media kind": (cache) => (cache.files[0].kind = "subtitle"),
  "missing preparation plan": (cache) => delete cache.plan,
};

for (const [name, corrupt] of Object.entries(corruptions)) {
  test(`cache recovery repairs ${name} instead of reporting a ready unusable video`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "seen-said-cache-repair-"));
    try {
      const source = join(directory, "episode.mkv");
      await writeFile(source, "original");
      const options = {
        source,
        cacheRoot: join(directory, "cache"),
        ffmpeg: "ffmpeg",
        ffprobe: "ffprobe",
        run: async (_executable, args) => {
          if (args.includes("-show_streams"))
            return JSON.stringify({
              streams: [
                { index: 0, codec_type: "video", codec_name: "hevc" },
                { index: 1, codec_type: "subtitle", codec_name: "subrip" },
              ],
            });
          await writeFile(args.at(-1), args.at(-1).endsWith(".mp4") ? "video" : "subtitle");
          return "";
        },
      };
      const first = await prepareMedia(options);
      const manifest = join(options.cacheRoot, first.key, "manifest.json");
      const cache = JSON.parse(await readFile(manifest, "utf8"));
      corrupt(cache);
      await writeFile(manifest, JSON.stringify(cache));
      const repaired = await prepareMedia(options);
      assert.deepEqual(repaired.plan, first.plan);
      assert.deepEqual(repaired.files, first.files);
      assert.equal(await readFile(repaired.files[0].path, "utf8"), "video");
      assert.equal(await readFile(repaired.files[1].path, "utf8"), "subtitle");
      assert.equal(await readFile(source, "utf8"), "original");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
