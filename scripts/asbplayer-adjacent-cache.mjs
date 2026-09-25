import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
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
import { basename, dirname, extname, join } from "node:path";

const languageLabel = (language) => {
  if (/^(eng|en)$/iu.test(language)) return "英语";
  if (/^(chi|zho|zh|chs|cht)$/iu.test(language)) return "中文";
  return /^[a-z]{2,3}$/iu.test(language) ? language.toLowerCase() : "未知语言";
};

function displayFiles(source, plan, suffix) {
  const original = basename(source, extname(source));
  const stem =
    original.length <= 210 ? original : `${original.slice(0, 178)}…${original.slice(-30)}`;
  return [
    `${stem}.浏览器${suffix}.mp4`,
    ...plan.subtitles.map(
      (track) =>
        `${stem}.${languageLabel(track.language)}.轨道${track.index}${suffix}.${track.extension}`,
    ),
  ];
}

async function loadAdjacent(cached, source, directory, key, validManifest) {
  if (
    cached.layout !== "adjacent-v1" ||
    !validManifest(cached, key) ||
    !/^$|^ \([2-9]\d*\)$|^ \(1\d+\)$/u.test(cached.suffix)
  )
    throw new Error("Invalid cache");
  const names = displayFiles(source, cached.plan, cached.suffix);
  const files = [];
  for (let index = 0; index < cached.files.length; index++) {
    const file = cached.files[index];
    const expected =
      index === 0
        ? "video.mp4"
        : `subtitle-${cached.plan.subtitles[index - 1].index}.${cached.plan.subtitles[index - 1].extension}`;
    if (file.localName !== names[index] || file.file !== expected) throw new Error("Invalid cache");
    const path = join(directory, names[index]);
    const info = await stat(path);
    if (
      !info.isFile() ||
      info.size !== file.size ||
      info.mtimeMs !== file.mtimeMs ||
      (await realpath(path)) !== path
    )
      throw new Error("Invalid cache");
    files.push({ ...file, name: names[index], path });
  }
  return { ...cached, cacheDirectory: directory, files };
}

/** Native-picked cache only: records identify subtitles without needing the original movie. */
export async function openAdjacentMedia(selected, validManifest) {
  try {
    const path = await realpath(selected);
    const directory = dirname(path);
    const match = /^(.*)\.浏览器( \(\d+\))?\.mp4$/u.exec(basename(path));
    if (!match || !match[1]) throw new Error("Invalid cache");
    const records = join(directory, "缓存记录");
    if ((await realpath(records)) !== records) throw new Error("Invalid cache");
    const source = join(dirname(directory), `${match[1]}.mkv`);
    const entries = (await readdir(records)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    if (entries.length > 2000) throw new Error("Invalid cache");
    for (const name of entries) {
      try {
        const record = join(records, name);
        const info = await stat(record);
        if (!info.isFile() || info.size > 256_000 || (await realpath(record)) !== record) continue;
        const cached = JSON.parse(await readFile(record, "utf8"));
        if (!/^[a-f0-9]{64}$/u.test(cached.key) || cached.files?.[0]?.localName !== basename(path))
          continue;
        const result = await loadAdjacent(cached, source, directory, cached.key, validManifest);
        return { ...result, sidecarSource: source, reused: true };
      } catch {
        // A damaged/unrelated record never authorizes another path or triggers conversion.
      }
    }
  } catch {
    // The native selection is the sole input; errors do not reveal other local records.
  }
  throw new Error("缓存不可用，请选择语见生成且保留缓存记录的「.浏览器.mp4」视频。");
}

/** Adjacent publication owns names and reuse; the existing converter still owns codecs. */
export async function prepareAdjacentMedia(options, prepare, validManifest) {
  const { source, key, progress } = options;
  const directory = join(dirname(source), "缓存视频");
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== directory) throw new Error("缓存目录不能链接到其他位置。");
  const records = join(directory, "缓存记录");
  await mkdir(records, { recursive: true });
  if ((await realpath(records)) !== records) throw new Error("缓存记录目录不能链接到其他位置。");
  const record = join(records, `${createHash("sha256").update(source).digest("hex")}.json`);
  const load = async () => {
    const cached = JSON.parse(await readFile(record, "utf8"));
    return loadAdjacent(cached, source, directory, key, validManifest);
  };
  try {
    const cached = await load();
    progress("使用已准备的缓存");
    return { ...cached, reused: true };
  } catch {
    // Never remove or overwrite an unverified file, including an edited cache file.
  }
  let prepared;
  if (options.legacyCacheRoot) {
    try {
      prepared = await prepare({
        ...options,
        cacheRoot: options.legacyCacheRoot,
        readOnly: true,
        progress: () => undefined,
      });
      progress("复用旧缓存，整理到原视频旁");
    } catch {
      // Read-only inspection cannot modify the old cache or start another conversion.
    }
  }
  const temporary = await mkdtemp(join(directory, ".准备中-"));
  const published = [];
  try {
    const migrated = prepared !== undefined;
    prepared ??= await prepare({ ...options, cacheRoot: temporary });
    let suffix = "",
      names;
    for (let attempt = 1; attempt <= 999; attempt++) {
      suffix = attempt === 1 ? "" : ` (${attempt})`;
      names = displayFiles(source, prepared.plan, suffix);
      // Exclusive creation also protects concurrent publishers and user-created files.
      try {
        for (let index = 0; index < prepared.files.length; index++) {
          const destination = join(directory, names[index]);
          const input = prepared.files[index].path;
          if (!migrated) {
            try {
              await link(input, destination);
            } catch (error) {
              if (!["EPERM", "ENOSYS", "ENOTSUP", "EXDEV"].includes(error.code)) throw error;
              await copyFile(input, destination, constants.COPYFILE_EXCL);
            }
          } else await copyFile(input, destination, constants.COPYFILE_EXCL);
          published.push(destination);
        }
        break;
      } catch (error) {
        for (const path of published.splice(0)) await rm(path);
        if (error.code !== "EEXIST" || attempt === 999) throw error;
      }
    }
    const files = await Promise.all(
      prepared.files.map(async (file, index) => {
        const info = await stat(published[index]);
        return {
          file: file.file,
          kind: file.kind,
          type: file.type,
          language: file.language,
          name: names[index],
          localName: names[index],
          size: info.size,
          mtimeMs: info.mtimeMs,
        };
      }),
    );
    const after = await stat(source);
    if (
      after.size !== options.sourceIdentity.size ||
      after.mtimeMs !== options.sourceIdentity.mtimeMs
    )
      throw new Error("处理期间原文件发生变化，请重新选择。");
    const result = { layout: "adjacent-v1", key, plan: prepared.plan, suffix, files };
    const pending = join(records, `${randomUUID()}.pending`);
    await writeFile(pending, JSON.stringify(result), { flag: "wx" });
    try {
      await rename(record, `${record}.previous-${randomUUID()}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(pending, record);
    return await load();
  } catch (error) {
    for (const path of published) await rm(path, { force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
