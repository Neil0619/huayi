import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as media from "./asbplayer-media.mjs";

async function fixture(run) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "seen-said-prepared-")));
  const source = join(directory, "Show.S01E01.mkv");
  let toolCalls = 0;
  try {
    await writeFile(source, "original-video");
    const options = {
      source,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      run: async (_exe, args) => {
        toolCalls++;
        if (args.includes("-show_streams"))
          return JSON.stringify({
            streams: [
              { index: 0, codec_type: "video", codec_name: "h264" },
              { index: 1, codec_type: "audio", codec_name: "ac3" },
              { index: 2, codec_type: "subtitle", codec_name: "subrip", tags: { language: "eng" } },
            ],
          });
        await writeFile(
          args.at(-1),
          args.at(-1).endsWith("mp4") ? "cached-video" : "cached-subtitle",
        );
        return "";
      },
    };
    const prepared = await media.prepareMedia(options);
    await run({ directory, source, options, prepared, toolCalls: () => toolCalls });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a prepared video opens with its exact subtitles without the original or conversion", async () => {
  await fixture(async ({ source, prepared, toolCalls }) => {
    await rm(source);
    const calls = toolCalls();
    const opened = await media.openPreparedMedia(prepared.files[0].path);
    assert.deepEqual(opened.files, prepared.files);
    assert.equal(opened.sidecarSource, source);
    assert.equal(opened.reused, true);
    assert.equal(toolCalls(), calls);
    assert.equal(await readFile(opened.files[1].path, "utf8"), "cached-subtitle");
  });
});

test("selecting the original explicitly reports reuse without running either media tool again", async () => {
  await fixture(async ({ options, prepared, toolCalls }) => {
    const calls = toolCalls();
    const opened = await media.prepareMedia(options);
    assert.deepEqual(opened.files, prepared.files);
    assert.equal(opened.reused, true);
    assert.equal(toolCalls(), calls);
  });
});

test("cache opening rejects modified files and manifest paths outside the selected cache", async () => {
  await fixture(async ({ prepared }) => {
    const video = prepared.files[0].path;
    const records = join(dirname(video), "缓存记录");
    const record = join(
      records,
      (await readdir(records)).find((name) => name.endsWith(".json")),
    );
    const original = await readFile(record, "utf8");
    const unsafe = JSON.parse(original);
    unsafe.files[1].localName = "../private.srt";
    await writeFile(record, JSON.stringify(unsafe));
    await assert.rejects(media.openPreparedMedia(video), /缓存/u);
    await writeFile(record, original);
    await writeFile(prepared.files[1].path, "changed-subtitle");
    await assert.rejects(media.openPreparedMedia(video), /缓存/u);
  });
});

test("an arbitrary MP4 is not silently converted by the prepared-cache entry", async () => {
  await fixture(async ({ directory, toolCalls }) => {
    const other = join(directory, "other.mp4");
    await writeFile(other, "user-owned");
    const calls = toolCalls();
    await assert.rejects(media.openPreparedMedia(other), /缓存/u);
    assert.equal(await readFile(other, "utf8"), "user-owned");
    assert.equal(toolCalls(), calls);
  });
});
