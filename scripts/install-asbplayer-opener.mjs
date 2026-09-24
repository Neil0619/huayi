import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const scripts = [
  "asbplayer-open.mjs",
  "asbplayer-media.mjs",
  "asbplayer-opener-server.mjs",
  "asbplayer-opener-ui.mjs",
];
const launcher = `$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
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

export async function createMediaOpenerShortcut({
  destination,
  previousDestination,
  desktopDirectory,
  launch = spawn,
}) {
  const command = `$ErrorActionPreference = 'Stop'
$root = $env:SEEN_SAID_INSTALL_ROOT
$target = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
function Get-LauncherArguments([string]$directory) {
  return '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $directory '打开语见本机视频.ps1') + '"'
}
$arguments = Get-LauncherArguments $root
$previousArguments = Get-LauncherArguments $env:SEEN_SAID_PREVIOUS_ROOT
$desktop = if ($env:SEEN_SAID_DESKTOP) { $env:SEEN_SAID_DESKTOP } else { [Environment]::GetFolderPath('Desktop') }
$path = Join-Path $desktop '语见本机视频.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($path)
if ((Test-Path -LiteralPath $path) -and (($shortcut.TargetPath -ine $target) -or (($shortcut.Arguments -cne $arguments) -and ($shortcut.Arguments -cne $previousArguments)))) {
  throw 'Existing shortcut belongs to another installation'
}
$shortcut.TargetPath = $target
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $root
$shortcut.Description = '语见：打开原视频并自动准备音轨和字幕'
$shortcut.Save()`;
  await new Promise((resolvePromise, reject) => {
    const child = launch("powershell.exe", ["-NoProfile", "-Command", command], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SEEN_SAID_INSTALL_ROOT: destination,
        SEEN_SAID_PREVIOUS_ROOT: previousDestination ?? destination,
        SEEN_SAID_DESKTOP: desktopDirectory ?? "",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error("快捷方式创建失败，未替换其他安装入口。")),
    );
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
