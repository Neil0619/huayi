// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

import { createStoreExtensionConfig } from "../vite.config.js";

describe("Store build profile isolation", () => {
  it.each(["content", "youtube-content", "youtube-main", "options", "popup", "background"])(
    "%s release builds cannot overwrite the installed hosted package identity",
    (mode) => {
      const hosted = createStoreExtensionConfig(mode, "hosted-acceptance");
      const release = createStoreExtensionConfig(mode, "release");
      expect(hosted.build?.outDir).not.toBe(release.build?.outDir);
      expect(basename(hosted.build?.outDir ?? "")).toBe("dist");
      expect(basename(release.build?.outDir ?? "")).toBe("dist-release");
    },
  );

  it("a complete ordinary build leaves the existing hosted manifest and worker unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-profile-isolation-"));
    const buildMode = async (mode: string, profile: "release" | "hosted-acceptance") => {
      const config = createStoreExtensionConfig(mode, profile);
      const configuredOutput = config.build?.outDir;
      if (configuredOutput === undefined) throw new Error("Build output missing");
      const outDir = join(directory, basename(configuredOutput));
      await build({ ...config, configFile: false, build: { ...config.build, outDir } });
      return outDir;
    };
    try {
      const hosted = await buildMode("background", "hosted-acceptance");
      const manifest = await readFile(join(hosted, "manifest.json"), "utf8");
      const worker = await readFile(join(hosted, "service-worker.js"), "utf8");
      for (const mode of [
        "content",
        "youtube-content",
        "youtube-main",
        "options",
        "popup",
        "background",
      ])
        await buildMode(mode, "release");
      expect(await readFile(join(hosted, "manifest.json"), "utf8")).toBe(manifest);
      expect(await readFile(join(hosted, "service-worker.js"), "utf8")).toBe(worker);
      const release = JSON.parse(
        await readFile(join(directory, "dist-release/manifest.json"), "utf8"),
      );
      expect(release).not.toHaveProperty("key");
      expect(release.host_permissions).not.toContain("https://api.acceptance.seen-said.cn/*");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
