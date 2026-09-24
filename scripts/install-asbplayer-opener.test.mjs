import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  createMediaOpenerShortcut,
  installMediaOpener,
  installUserMediaOpener,
} from "./install-asbplayer-opener.mjs";

const runFile = promisify(execFile);

test(
  "Windows shortcut migrates its owned legacy entry and launches the installed script",
  {
    skip:
      process.platform !== "win32"
        ? "Requires Windows Shell shortcuts and Windows PowerShell"
        : false,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "seen-said-shortcut-test-"));
    try {
      const desktopDirectory = join(root, "desktop-\u{1f9ea}");
      await mkdir(desktopDirectory);
      const nodeDirectory = join(root, "工具 \u{1f9ea}");
      await mkdir(nodeDirectory);
      const nodePath = join(nodeDirectory, "node.exe");
      await copyFile(process.execPath, nodePath);
      const destination = join(root, "用户 profile", "SeenSaid", "asbplayer-opener");
      const previousDestination = join(root, "AppData", "Local", "SeenSaid", "asbplayer-opener");
      const config = {
        node: nodePath,
        ffmpeg: process.execPath,
        ffprobe: process.execPath,
        chrome: process.execPath,
      };
      // Build a real legacy installation; Windows Shell may validate its working directory.
      await installMediaOpener({ destination: previousDestination, config });
      await installMediaOpener({ destination, config });
      await writeFile(
        join(destination, "asbplayer-open.mjs"),
        `import { writeFileSync } from "node:fs"; writeFileSync(new URL("./launched.json", import.meta.url), JSON.stringify(process.argv.slice(2)));`,
      );
      const createShortcut = async (options) => {
        let diagnostic = "";
        try {
          await createMediaOpenerShortcut({
            ...options,
            launch: (command, args, settings) => {
              const child = spawn(command, args, {
                ...settings,
                stdio: ["ignore", "ignore", "pipe"],
              });
              child.stderr.on("data", (chunk) => {
                diagnostic = (diagnostic + chunk.toString()).slice(0, 4000);
              });
              return child;
            },
          });
        } catch (error) {
          throw new Error(`Native shortcut fixture failed: ${diagnostic}`, { cause: error });
        }
      };
      await createShortcut({ destination: previousDestination, desktopDirectory });
      await createShortcut({ destination, previousDestination, desktopDirectory });
      const link = join(desktopDirectory, "语见本机视频.lnk");
      await runFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Start-Process -FilePath $env:SEEN_SAID_TEST_LINK -WindowStyle Hidden -Wait",
        ],
        { windowsHide: true, env: { ...process.env, SEEN_SAID_TEST_LINK: link }, timeout: 15000 },
      );
      assert.deepEqual(JSON.parse(await readFile(join(destination, "launched.json"), "utf8")), [
        join(destination, "config.json"),
      ]);
      const originalLink = await readFile(link);
      await assert.rejects(
        createMediaOpenerShortcut({ destination: join(root, "unrelated"), desktopDirectory }),
      );
      assert.deepEqual(await readFile(link), originalLink);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("user installation stays outside virtualized AppData and preserves the previous configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "seen-said-user-install-test-"));
  try {
    const userProfile = join(root, "用户 profile");
    const localAppData = join(userProfile, "AppData", "Local");
    const previous = join(localAppData, "SeenSaid", "asbplayer-opener");
    const expected = join(userProfile, "SeenSaid", "asbplayer-opener");
    const config = {
      node: process.execPath,
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      chrome: process.execPath,
      cacheRoot: join(root, "existing-cache"),
    };
    await mkdir(previous, { recursive: true });
    await mkdir(config.cacheRoot);
    await writeFile(join(config.cacheRoot, "keep.txt"), "original cache");
    await writeFile(join(previous, "config.json"), JSON.stringify(config));
    const destination = await installUserMediaOpener({
      userProfile,
      localAppData,
      config: { ...config, cacheRoot: "must-not-replace" },
    });
    assert.equal(destination, expected);
    assert.deepEqual(JSON.parse(await readFile(join(destination, "config.json"), "utf8")), config);
    assert.ok(
      (await readFile(join(destination, "asbplayer-open.mjs"), "utf8")).includes(
        "startMediaOpener",
      ),
    );
    assert.equal(await readFile(join(config.cacheRoot, "keep.txt"), "utf8"), "original cache");
    assert.deepEqual(JSON.parse(await readFile(join(previous, "config.json"), "utf8")), config);
    const updated = { ...config, cacheRoot: join(root, "new-preference") };
    await writeFile(join(destination, "config.json"), JSON.stringify(updated));
    await installUserMediaOpener({ userProfile, localAppData, config });
    assert.deepEqual(JSON.parse(await readFile(join(destination, "config.json"), "utf8")), updated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stable installation updates owned scripts while preserving local configuration and unrelated files", async () => {
  const destination = await mkdtemp(join(tmpdir(), "seen-said-install-test-"));
  try {
    const config = {
      node: process.execPath,
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      chrome: process.execPath,
      cacheRoot: join(destination, "cache"),
    };
    await writeFile(join(destination, "notes.txt"), "keep");
    await installMediaOpener({ destination, config });
    const installed = await readFile(join(destination, "asbplayer-open.mjs"), "utf8");
    assert.ok(installed.includes("startMediaOpener"));
    assert.deepEqual(JSON.parse(await readFile(join(destination, "config.json"), "utf8")), config);
    await installMediaOpener({ destination, config: { ...config, cacheRoot: "must-not-replace" } });
    assert.equal(
      JSON.parse(await readFile(join(destination, "config.json"), "utf8")).cacheRoot,
      config.cacheRoot,
    );
    assert.equal(await readFile(join(destination, "notes.txt"), "utf8"), "keep");
    const launcher = await readFile(join(destination, "打开语见本机视频.ps1"), "utf8");
    assert.ok(launcher.includes("-WindowStyle Hidden"));
    assert.ok(launcher.includes("$PSScriptRoot"));
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
