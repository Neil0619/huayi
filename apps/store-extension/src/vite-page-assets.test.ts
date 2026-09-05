// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import { createStoreExtensionConfig } from "../vite.config.js";
import { loadPackagedWorker } from "./packaged-worker.test-support.js";

function localStylesheetReferences(source: string): string[] {
  return Array.from(source.matchAll(/(?:href|url)="([^"/:]+\.css)"/gu)).flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function localImports(source: string): string[] {
  return Array.from(source.matchAll(/@import\s+"\.\/([^"/]+\.css)"/gu)).flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe("Store Vite page assets", () => {
  it("copies the packaged Overlay stylesheet into the final background build", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "huayi-store-overlay-asset-"));
    try {
      const config = createStoreExtensionConfig("background", "release");
      await build({
        ...config,
        build: { ...config.build, emptyOutDir: true, outDir },
        configFile: false,
      });
      await expect(stat(join(outDir, "overlay.css"))).resolves.toBeDefined();
      const worker = loadPackagedWorker(
        await readFile(join(outDir, "service-worker.js"), "utf8"),
        "store-release-test",
      );
      for (const type of ["store/cloud-session-status", "store/cloud-session-start"]) {
        await expect(worker.send(type)).resolves.toMatchObject({ status: "not-configured" });
      }
      expect(worker.requests).toEqual([]);
      expect(worker.openedUrls).toEqual([]);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
  it("copies the Options HTML stylesheet and every local stylesheet import into its build output", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "huayi-store-options-assets-"));
    try {
      const config = createStoreExtensionConfig("options");
      await build({
        ...config,
        build: { ...config.build, emptyOutDir: true, outDir },
        configFile: false,
      });

      const html = await readFile(join(outDir, "options.html"), "utf8");
      const stylesheet = localStylesheetReferences(html);
      expect(stylesheet).toEqual([
        "options.css",
        "options-components.css",
        "options-site-rules.css",
      ]);
      for (const file of stylesheet) {
        const css = await readFile(join(outDir, file), "utf8");
        for (const importedFile of localImports(css)) {
          await expect(stat(join(outDir, importedFile))).resolves.toBeDefined();
        }
      }
      await expect(stat(join(outDir, "brand-theme.css"))).resolves.toBeDefined();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it("copies the shared visual contract into the Popup build output", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "huayi-store-popup-assets-"));
    try {
      const config = createStoreExtensionConfig("popup");
      await build({
        ...config,
        build: { ...config.build, emptyOutDir: true, outDir },
        configFile: false,
      });

      const css = await readFile(join(outDir, "popup.css"), "utf8");
      expect(localImports(css)).toContain("brand-theme.css");
      await expect(stat(join(outDir, "brand-theme.css"))).resolves.toBeDefined();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
