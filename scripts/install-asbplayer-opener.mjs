import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMediaOpenerShortcut } from "./asbplayer-windows-shortcut.mjs";

export { createMediaOpenerShortcut };

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const scripts = [
  "asbplayer-open.mjs",
  "asbplayer-media.mjs",
  "asbplayer-opener-server.mjs",
  "asbplayer-opener-ui.mjs",
];
const launcher = `$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$entry = Join-Path $PSScriptRoot 'asbplayer-open.mjs'
$arguments = @(('"' + $entry + '"'), ('"' + $configPath + '"'))
Start-Process -FilePath $config.node -ArgumentList $arguments -WindowStyle Hidden
`;

export async function installMediaOpener({ destination, config }) {
  destination = resolve(destination);
  for (const field of ["node", "ffmpeg", "ffprobe", "chrome"]) {
    if (typeof config[field] !== "string") throw new Error(`缺少配置：${field}`);
    await access(config[field]);
  }
  await mkdir(destination, { recursive: true });
  for (const script of scripts)
    await copyFile(join(sourceDirectory, script), join(destination, script));
  try {
    await writeFile(join(destination, "config.json"), JSON.stringify(config, null, 2), {
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await writeFile(join(destination, "打开语见本机视频.ps1"), launcher);
  return destination;
}

export async function installUserMediaOpener({ userProfile, localAppData, config }) {
  // Packaged development hosts can virtualize AppData. Explorer cannot see those writes.
  const destination = join(userProfile, "SeenSaid", "asbplayer-opener");
  const previousDestination = join(localAppData, "SeenSaid", "asbplayer-opener");
  const readConfiguration = async (directory) => {
    try {
      return JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  };
  return installMediaOpener({
    destination,
    config:
      (await readConfiguration(destination)) ??
      (await readConfiguration(previousDestination)) ??
      config,
  });
}

async function main() {
  if (
    process.platform !== "win32" ||
    !process.env.LOCALAPPDATA ||
    !process.env.USERPROFILE ||
    !process.argv[2]
  )
    throw new Error("请在 Windows 使用：node scripts/install-asbplayer-opener.mjs <本机配置.json>");
  const config = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  const destination = await installUserMediaOpener({
    userProfile: process.env.USERPROFILE,
    localAppData: process.env.LOCALAPPDATA,
    config,
  });
  await createMediaOpenerShortcut({
    destination,
    previousDestination: join(process.env.LOCALAPPDATA, "SeenSaid", "asbplayer-opener"),
  });
  console.log("已安装或更新语见本机视频打开器。请使用桌面快捷方式；现有配置和缓存保持不变。");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
