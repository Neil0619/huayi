// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
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
      const production = createStoreExtensionConfig(mode, "production");
      expect(hosted.build?.outDir).not.toBe(release.build?.outDir);
      expect(basename(hosted.build?.outDir ?? "")).toBe("dist");
      expect(basename(release.build?.outDir ?? "")).toBe("dist-release");
      expect(basename(production.build?.outDir ?? "")).toBe("dist-production");
      expect(production.define).toMatchObject({
        HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE: JSON.stringify("https://api.seen-said.cn"),
        HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE: JSON.stringify("https://app.seen-said.cn/app"),
        HUAYI_WEB_ORIGIN_BUILD_VALUE: JSON.stringify("https://app.seen-said.cn"),
      });
    },
  );

  it("production package has its own identity and only uses production cloud endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-production-profile-"));
    try {
      const config = createStoreExtensionConfig("background", "production");
      await build({ ...config, configFile: false, build: { ...config.build, outDir: directory } });
      const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
      const worker = await readFile(join(directory, "service-worker.js"), "utf8");
      const hosted = JSON.parse(
        await readFile("apps/store-extension/manifest.hosted-acceptance.json", "utf8"),
      );
      expect(manifest.key).not.toBe(hosted.key);
      expect(
        createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16),
      ).not.toEqual(
        createHash("sha256").update(Buffer.from(hosted.key, "base64")).digest().subarray(0, 16),
      );
      expect(manifest.host_permissions).toContain("https://api.seen-said.cn/*");
      expect(manifest.host_permissions).not.toContain("https://api.acceptance.seen-said.cn/*");
      expect(worker).toContain("https://api.seen-said.cn");
      expect(worker).toContain("https://app.seen-said.cn/app");
      expect(worker).not.toContain("acceptance.seen-said.cn");
      expect(worker).not.toContain("HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

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
    // Seven real Vite builds run serially against shared output directories. Keep their
    // integration budget local instead of inheriting the five-second unit-test limit.
  }, 30_000);
});
