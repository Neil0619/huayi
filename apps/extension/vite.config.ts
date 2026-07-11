import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import type { Plugin, UserConfig } from "vite";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(extensionRoot, "dist");

function copyExtensionAssets(): Plugin {
  return {
    name: "copy-extension-assets",
    async closeBundle() {
      await mkdir(resolve(outputDirectory, "assets"), { recursive: true });
      await copyFile(
        resolve(extensionRoot, "manifest.json"),
        resolve(outputDirectory, "manifest.json"),
      );
      await cp(resolve(extensionRoot, "assets"), resolve(outputDirectory, "assets"), {
        recursive: true,
      });
    },
  };
}

export function createExtensionConfig(mode: string): UserConfig {
  const isContentBuild = mode === "content";
  return {
    build: {
      emptyOutDir: isContentBuild,
      minify: "esbuild",
      outDir: outputDirectory,
      rollupOptions: {
        input: resolve(
          extensionRoot,
          isContentBuild ? "src/content/content-script.ts" : "src/background/service-worker.ts",
        ),
        output: {
          entryFileNames: isContentBuild ? "content-script.js" : "service-worker.js",
          format: isContentBuild ? "iife" : "es",
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      target: "chrome120",
    },
    plugins: isContentBuild ? [] : [copyExtensionAssets()],
  };
}

const extensionConfig = defineConfig(({ mode }) => createExtensionConfig(mode));

export default extensionConfig;
