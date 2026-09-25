import assert from "node:assert/strict";
import { writeFileSync as syncWrite } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { prepareMedia, findSidecars } from "./asbplayer-media.mjs";

const probe = {
  streams: [
    { index: 0, codec_type: "video", codec_name: "hevc" },
    { index: 1, codec_type: "audio", codec_name: "ac3", tags: { language: "eng" } },
    { index: 2, codec_type: "subtitle", codec_name: "subrip", tags: { language: "eng" } },
  ],
};

async function fixture(run) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "seen-said-adjacent-")));
  try {
    const source = join(directory, "Show.S09E01.mkv");
    await writeFile(source, "original");
    let conversions = 0;
    const options = {
      source,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      run: async (_exe, args) => {
        if (args.includes("-show_streams")) return JSON.stringify(probe);
        conversions++;
        await writeFile(
          args.at(-1),
          args.at(-1).endsWith(".mp4") ? "video-content" : "subtitle-content",
        );
        return "";
      },
    };
    await run({ directory, source, options, conversions: () => conversions });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("default cache sits next to the source with readable matching video and subtitle names", async () => {
  await fixture(async ({ directory, source, options, conversions }) => {
    const first = await prepareMedia(options);
    const root = join(directory, "缓存视频");
    assert.equal(first.cacheDirectory, root);
    assert.deepEqual(
      first.files.map((file) => basename(file.path)),
      ["Show.S09E01.浏览器.mp4", "Show.S09E01.英语.轨道2.srt"],
    );
    for (const file of first.files) {
      assert.equal(dirname(file.path), root);
      assert.equal(file.name, basename(file.path));
      assert.equal((await stat(file.path)).size, file.size);
    }
    const reused = await prepareMedia(options);
    assert.deepEqual(reused.files, first.files);
    assert.equal(conversions(), 2);
    assert.equal(await readFile(source, "utf8"), "original");
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith(".准备中-")),
      false,
    );
  });
});

test("old complete cache migrates without re-encoding or deleting old files", async () => {
  await fixture(async ({ directory, options, conversions }) => {
    const legacyCacheRoot = join(directory, "old-project-cache");
    const old = await prepareMedia({ ...options, cacheRoot: legacyCacheRoot });
    const first = await prepareMedia({ ...options, legacyCacheRoot });
    assert.equal(conversions(), 2);
    assert.equal(dirname(first.files[0].path), join(directory, "缓存视频"));
    assert.equal(await readFile(first.files[0].path, "utf8"), "video-content");
    assert.equal(await readFile(old.files[0].path, "utf8"), "video-content");
  });
});

test("same stem with different source extensions and existing user files never overwrite each other", async () => {
  await fixture(async ({ directory, options }) => {
    const first = await prepareMedia(options);
    const secondSource = join(directory, "Show.S09E01.mp4");
    await writeFile(secondSource, "second-original");
    const second = await prepareMedia({ ...options, source: secondSource });
    assert.notEqual(first.files[0].path, second.files[0].path);
    assert.match(basename(second.files[0].path), /^Show\.S09E01.*\.mp4$/u);
    assert.equal(await readFile(first.files[0].path, "utf8"), "video-content");
    assert.equal(await readFile(secondSource, "utf8"), "second-original");
    await writeFile(first.files[0].path, "user-replacement-content");
    const repaired = await prepareMedia(options);
    assert.notEqual(repaired.files[0].path, first.files[0].path);
    assert.equal(await readFile(first.files[0].path, "utf8"), "user-replacement-content");
    assert.equal(await readFile(repaired.files[0].path, "utf8"), "video-content");
  });
});

test("cache subtitles are not rediscovered as neighboring source subtitles", async () => {
  await fixture(async ({ directory, source, options }) => {
    await prepareMedia(options);
    await writeFile(join(directory, "Show.S09E01.ChsEng.ass"), "neighbor");
    assert.deepEqual(
      (await findSidecars(source)).map((file) => file.name),
      ["Show.S09E01.ChsEng.ass"],
    );
  });
});

test("a source changed during legacy migration cannot be reported as ready", async () => {
  await fixture(async ({ directory, options }) => {
    const legacyCacheRoot = join(directory, "legacy");
    await prepareMedia({ ...options, cacheRoot: legacyCacheRoot });
    await assert.rejects(
      prepareMedia({
        ...options,
        legacyCacheRoot,
        progress: (message) => {
          if (message === "复用旧缓存，整理到原视频旁") {
            // Synchronous source replacement models an external write during publication.
            replaceSource();
          }
        },
      }),
      /原文件发生变化/u,
    );
    function replaceSource() {
      syncWrite(options.source, "changed-original");
    }
  });
});

test("a linked cache directory cannot redirect publication outside the source directory", async () => {
  await fixture(async ({ directory, options }) => {
    const other = await mkdtemp(join(tmpdir(), "seen-said-other-cache-"));
    try {
      await symlink(
        other,
        join(directory, "缓存视频"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await assert.rejects(prepareMedia(options), /缓存目录不能链接/u);
      assert.deepEqual(await readdir(other), []);
    } finally {
      await rm(join(directory, "缓存视频"), { force: true, recursive: true });
      await rm(other, { recursive: true, force: true });
    }
  });
});

test("an existing named video is preserved even if it was not created by the opener", async () => {
  await fixture(async ({ directory, options }) => {
    const root = join(directory, "缓存视频");
    await mkdir(root);
    const existing = join(root, "Show.S09E01.浏览器.mp4");
    await writeFile(existing, "user-file");
    const prepared = await prepareMedia(options);
    assert.equal(await readFile(existing, "utf8"), "user-file");
    assert.equal(basename(prepared.files[0].path), "Show.S09E01.浏览器 (2).mp4");
  });
});
