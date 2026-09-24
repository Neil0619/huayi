import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareMedia, findSidecars } from "./asbplayer-media.mjs";
import { startMediaOpener } from "./asbplayer-opener-server.mjs";

export function pickWindowsMedia(subtitle = false) {
  const filter = subtitle ? "文字字幕|*.srt;*.ass;*.ssa;*.vtt" : "本地视频|*.mkv;*.mp4;*.m4v";
  const script = `Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.OpenFileDialog; $picker.Filter = '${filter}'; $picker.Title = '语见：选择${subtitle ? "字幕" : "原视频"}'; if ($picker.ShowDialog() -eq 'OK') { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($picker.FileName)) }; $picker.Dispose()`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolvePromise(
            output.trim() ? Buffer.from(output.trim(), "base64").toString("utf8") : null,
          )
        : reject(new Error("无法打开文件选择窗口。")),
    );
  });
}

async function main() {
  if (process.platform !== "win32")
    throw new Error("此启动器目前仅支持 Windows；其他平台的原生打开流程尚未验证。");
  const configPath = process.argv[2];
  if (!configPath) throw new Error("用法：node scripts/asbplayer-open.mjs <本机配置.json>");
  const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
  for (const field of ["ffmpeg", "ffprobe", "chrome"]) {
    if (typeof config[field] !== "string") throw new Error(`缺少本机配置：${field}`);
    await access(config[field]);
  }
  const cacheRoot =
    config.cacheRoot ?? join(process.env.LOCALAPPDATA ?? homedir(), "SeenSaid", "media-cache");
  const opener = await startMediaOpener({
    pickFile: pickWindowsMedia,
    sidecars: findSidecars,
    prepare: (source, progress) =>
      prepareMedia({ source, cacheRoot, ffmpeg: config.ffmpeg, ffprobe: config.ffprobe, progress }),
  });
  // URL contains a private per-process token: never print or persist it.
  const browser = spawn(config.chrome, [opener.url], {
    detached: true,
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
  browser.once("error", () => {
    void opener.close();
  });
  browser.unref();
  process.once("SIGINT", () => {
    void opener.close();
  });
  process.once("SIGTERM", () => {
    void opener.close();
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error("本机打开器启动失败。请检查配置文件、Chrome 和媒体工具路径。");
    process.exitCode = 1;
  });
}
// Keep the CLI entry importable by Windows integration tests.
export const openerEntryPath = fileURLToPath(import.meta.url);
