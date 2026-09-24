import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planMedia, prepareMedia, findSidecars } from "./asbplayer-media.mjs";

const probe = {
  streams: [
    { index: 0, codec_type: "video", codec_name: "hevc" },
    { index: 1, codec_type: "audio", codec_name: "ac3", tags: { language: "eng" } },
    { index: 2, codec_type: "subtitle", codec_name: "subrip", tags: { language: "eng" } },
    { index: 3, codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle" },
  ],
};
test("MKV plan copies HEVC, converts AC3 and exposes embedded text without pretending PGS is text", () => {
  const plan = planMedia(probe);
  assert.equal(plan.videoCodec, "hevc");
  assert.equal(plan.audioCodec, "aac");
  assert.equal(plan.audioIndex, 1);
  assert.deepEqual(plan.subtitles, [{ index: 2, extension: "srt", language: "eng" }]);
  assert.equal(plan.imageSubtitleCount, 1);
});
test("AAC is copied; unsupported video fails clearly before expensive processing", () => {
  assert.equal(
    planMedia({
      streams: [
        { ...probe.streams[0], codec_name: "h264" },
        { ...probe.streams[1], codec_name: "aac" },
      ],
    }).audioCodec,
    "copy",
  );
  assert.throws(
    () => planMedia({ streams: [{ ...probe.streams[0], codec_name: "mpeg2video" }] }),
    /视频编码/u,
  );
});
test("preparation publishes complete cache only, reuses it and never overwrites input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-media-test-"));
  try {
    const source = join(directory, "episode.mkv");
    await writeFile(source, "original-video");
    let calls = 0;
    const run = async (_executable, args) => {
      if (args.includes("-show_streams")) return JSON.stringify(probe);
      calls++;
      assert.ok(args.includes("-n"));
      assert.ok(args.includes(source));
      assert.ok(!args.includes("-t"));
      await writeFile(args.at(-1), "prepared");
      return "";
    };
    const options = {
      source,
      cacheRoot: join(directory, "cache"),
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      run,
    };
    const first = await prepareMedia(options);
    assert.equal(first.files.length, 2);
    assert.equal(first.files[1].kind, "subtitle");
    assert.equal(await readFile(source, "utf8"), "original-video");
    const second = await prepareMedia(options);
    assert.deepEqual(second.files, first.files);
    assert.equal(calls, 2);
    await writeFile(first.files[0].path, "truncated");
    const repaired = await prepareMedia(options);
    assert.equal(await readFile(repaired.files[0].path, "utf8"), "prepared");
    assert.equal(calls, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("failed conversion never becomes a reusable successful cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-media-failed-"));
  try {
    const source = join(directory, "episode.mkv");
    await writeFile(source, "original");
    const options = {
      source,
      cacheRoot: join(directory, "cache"),
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      run: async (_exe, args) => {
        if (args.includes("-show_streams")) return JSON.stringify(probe);
        await writeFile(args.at(-1), "partial");
        throw new Error("conversion failed");
      },
    };
    await assert.rejects(prepareMedia(options), /conversion failed/u);
    await assert.rejects(prepareMedia(options), /conversion failed/u);
    assert.equal(await readFile(source, "utf8"), "original");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("sidecars match episode or full stem and never take another episode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-sidecars-"));
  try {
    for (const file of [
      "Show.S09E01.ChsEng.ass",
      "Show.S09E02.ass",
      "Other.Show.S09E01.ass",
      "random.srt",
    ])
      await writeFile(join(directory, file), "sub");
    const result = await findSidecars(join(directory, "Show.S09E01.mkv"));
    assert.deepEqual(
      result.map((file) => file.name),
      ["Show.S09E01.ChsEng.ass"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
