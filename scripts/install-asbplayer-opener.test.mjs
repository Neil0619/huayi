import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installMediaOpener } from "./install-asbplayer-opener.mjs";

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
