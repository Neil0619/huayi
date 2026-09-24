import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

export function runMediaTool(executable, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 4_000_000) child.kill();
    });
    child.once("error", () =>
      reject(new Error("无法启动媒体工具，请检查 FFmpeg 和 ffprobe 路径。")),
    );
    child.once("exit", (code) =>
      code === 0 && output.length <= 4_000_000
        ? resolvePromise(output)
        : reject(new Error("媒体处理失败，请检查文件是否完整、磁盘空间是否充足。")),
    );
  });
}

export function planMedia(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(
    (stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic,
  );
  if (!video || !["h264", "hevc"].includes(video.codec_name)) {
    throw new Error(
      "暂不支持此视频编码；当前支持 H.264 和 HEVC，保留原文件，请使用其他播放器或先转换视频。 ",
    );
  }
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const audio =
    audios.find((stream) => /^(eng|en)$/iu.test(stream.tags?.language ?? "")) ?? audios[0];
  const subtitles = streams.filter((stream) => stream.codec_type === "subtitle");
  const text = subtitles.filter((stream) =>
    ["subrip", "ass", "ssa", "webvtt", "mov_text"].includes(stream.codec_name),
  );
  return {
    videoIndex: video.index,
    videoCodec: video.codec_name,
    audioIndex: audio?.index ?? null,
    audioCodec: audio?.codec_name === "aac" ? "copy" : "aac",
    audioLanguage: audio?.tags?.language ?? "und",
    audioTrackCount: audios.length,
    subtitles: text.slice(0, 12).map((stream) => ({
      index: stream.index,
      extension: ["ass", "ssa"].includes(stream.codec_name) ? "ass" : "srt",
      language: stream.tags?.language ?? "und",
    })),
    imageSubtitleCount: subtitles.length - text.length,
  };
}

export async function findSidecars(source) {
  const stem = basename(source, extname(source));
  const episode = /S\d{1,2}E\d{1,3}/iu.exec(stem)?.[0].toLowerCase();
  const series = (name) =>
    name
      .split(/S\d{1,2}E\d{1,3}/iu)[0]
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]/gu, "");
  const matches = (name) => {
    if (!/\.(srt|ass|ssa|vtt)$/iu.test(name)) return false;
    const other = /S\d{1,2}E\d{1,3}/iu.exec(name)?.[0].toLowerCase();
    return episode
      ? other === episode && series(name) === series(stem)
      : name.toLowerCase().startsWith(`${stem.toLowerCase()}.`);
  };
  const results = [];
  let inspected = 0;
  const visit = async (directory, depth) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++inspected > 2000 || results.length >= 12) return;
      const path = join(directory, entry.name);
      if (entry.isFile() && matches(entry.name) && (await stat(path)).size <= 16_000_000)
        results.push({ name: entry.name, path });
      else if (entry.isDirectory() && depth === 0) await visit(path, 1);
    }
  };
  await visit(dirname(source), 0);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function validCacheManifest(cached, key) {
  const plan = cached?.plan;
  const index = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    cached?.key !== key ||
    !plan ||
    !index(plan.videoIndex) ||
    !["h264", "hevc"].includes(plan.videoCodec) ||
    !(plan.audioIndex === null || index(plan.audioIndex)) ||
    !["copy", "aac"].includes(plan.audioCodec) ||
    typeof plan.audioLanguage !== "string" ||
    !index(plan.audioTrackCount) ||
    !index(plan.imageSubtitleCount) ||
    !Array.isArray(plan.subtitles) ||
    plan.subtitles.length > 12 ||
    !plan.subtitles.every(
      (track) =>
        track &&
        index(track.index) &&
        ["srt", "ass"].includes(track.extension) &&
        typeof track.language === "string",
    ) ||
    !Array.isArray(cached.files) ||
    cached.files.length !== plan.subtitles.length + 1
  )
    return false;
  const expected = new Map([
    ["video.mp4", { kind: "video", type: "video/mp4" }],
    ...plan.subtitles.map((track) => [
      `subtitle-${track.index}.${track.extension}`,
      { kind: "subtitle", type: "text/plain" },
    ]),
  ]);
  if (expected.size !== cached.files.length) return false;
  for (const file of cached.files) {
    const entry = expected.get(file?.file);
    if (
      !entry ||
      file.kind !== entry.kind ||
      file.type !== entry.type ||
      typeof file.name !== "string" ||
      !file.name.length ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0
    )
      return false;
    expected.delete(file.file);
  }
  return expected.size === 0;
}

export async function prepareMedia({
  source,
  cacheRoot,
  ffmpeg,
  ffprobe,
  run = runMediaTool,
  progress = () => undefined,
}) {
  source = await realpath(source);
  const before = await stat(source);
  if (!before.isFile()) throw new Error("请选择一个视频文件。");
  const identity = ["media-v1", source, before.size, before.mtimeMs, ffmpeg, ffprobe];
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  cacheRoot = resolve(cacheRoot);
  await mkdir(cacheRoot, { recursive: true });
  const target = join(cacheRoot, key);
  const load = async () => {
    const cached = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
    if (!validCacheManifest(cached, key)) throw new Error("Invalid cache");
    for (const file of cached.files) {
      const info = await stat(join(target, file.file));
      if (!info.isFile() || info.size !== file.size) throw new Error("Invalid cache");
    }
    return {
      ...cached,
      files: cached.files.map((file) => ({ ...file, path: join(target, file.file) })),
    };
  };
  try {
    const cached = await load();
    progress("使用已准备的缓存");
    return cached;
  } catch {
    // Retain damaged cache for inspection, then atomically publish a fresh generation.
    try {
      await rename(target, join(cacheRoot, `${key}-invalid-${randomUUID()}`));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  progress("检测视频、音轨和内嵌字幕");
  const probe = JSON.parse(
    await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", source]),
  );
  const plan = planMedia(probe);
  const temporary = await mkdtemp(join(cacheRoot, `${key}-`));
  try {
    progress(
      plan.audioCodec === "copy"
        ? "准备浏览器播放文件（复制音视频流）"
        : "转换音轨为 AAC（视频画面保持原样）",
    );
    const args = [
      "-n",
      "-v",
      "error",
      "-i",
      source,
      "-map",
      `0:${plan.videoIndex}`,
      "-c:v",
      "copy",
    ];
    if (plan.videoCodec === "hevc") args.push("-tag:v", "hvc1");
    if (plan.audioIndex !== null) {
      args.push("-map", `0:${plan.audioIndex}`, "-c:a", plan.audioCodec);
      if (plan.audioCodec !== "copy") args.push("-ac", "2", "-b:a", "192k");
    } else args.push("-an");
    args.push(
      "-sn",
      "-dn",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      join(temporary, "video.mp4"),
    );
    await run(ffmpeg, args);
    const files = [
      {
        file: "video.mp4",
        kind: "video",
        name: `${basename(source, extname(source))}.mp4`,
        type: "video/mp4",
      },
    ];
    for (const subtitle of plan.subtitles) {
      progress("提取内嵌文字字幕");
      const file = `subtitle-${subtitle.index}.${subtitle.extension}`;
      await run(ffmpeg, [
        "-n",
        "-v",
        "error",
        "-i",
        source,
        "-map",
        `0:${subtitle.index}`,
        "-c:s",
        subtitle.extension === "ass" ? "ass" : "srt",
        join(temporary, file),
      ]);
      files.push({
        file,
        kind: "subtitle",
        name: `内嵌-${subtitle.language}-${subtitle.index}.${subtitle.extension}`,
        language: subtitle.language,
        type: "text/plain",
      });
    }
    for (const file of files) {
      file.size = (await stat(join(temporary, file.file))).size;
      if (!file.size) throw new Error("媒体工具返回空文件，已停止打开。");
    }
    const after = await stat(source);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error("处理期间原文件发生变化，请重新选择。");
    const result = { key, plan, files };
    await writeFile(join(temporary, "manifest.json"), JSON.stringify(result), { flag: "wx" });
    // A bad cache is retained for inspection. A fresh generation uses a separate directory.
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      try {
        return await load();
      } catch {
        throw new Error("已有缓存不完整，请在关闭打开器后清理该集缓存再重试。");
      }
    }
    return await load();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
