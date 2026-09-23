// @vitest-environment node

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";

import { createStoreExtensionConfig } from "../vite.config.js";

describe("asbplayer packaged entrypoint boundary", () => {
  it.each(["release", "hosted-acceptance", "production"])(
    "%s packages only official playback frames",
    async (profile) => {
      const filename = profile === "release" ? "manifest.json" : `manifest.${profile}.json`;
      const manifest = JSON.parse(await readFile(`apps/store-extension/${filename}`, "utf8"));
      const frames = manifest.content_scripts.filter(
        (script: { all_frames: boolean }) => script.all_frames,
      );
      expect(frames).toEqual([
        {
          matches: ["https://app.asbplayer.dev/*"],
          js: ["asbplayer-content.js"],
          run_at: "document_idle",
          all_frames: true,
        },
        {
          matches: ["https://app.asbplayer.dev/*"],
          js: ["asbplayer-main.js"],
          run_at: "document_start",
          world: "MAIN",
          all_frames: true,
        },
      ]);
      for (const mode of ["asbplayer-content", "asbplayer-main"]) {
        const config = createStoreExtensionConfig(mode, profile);
        expect(basename(String(config.build?.rollupOptions?.input))).toBe(`${mode}-entry.ts`);
        expect(config.build?.rollupOptions?.output).toMatchObject({
          entryFileNames: `${mode}.js`,
          format: "iife",
          inlineDynamicImports: true,
        });
        expect(config.build?.emptyOutDir).toBe(false);
      }
    },
  );
});
