import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin, type UserConfig } from "vite";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(extensionRoot, "dist");
const PAGE_ASSETS = {
  options: ["options.html", "options.css", "options-components.css", "brand-theme.css"],
  popup: ["popup.html", "popup.css", "brand-theme.css"],
} as const;
const SHARED_CONTENT_ASSETS = ["overlay.css"] as const;

function copyManifest(): Plugin {
  let buildOutputDirectory = outputDirectory;
  return {
    name: "copy-store-manifest",
    configResolved(config) {
      buildOutputDirectory = config.build.outDir;
    },
    async closeBundle() {
      await mkdir(buildOutputDirectory, { recursive: true });
      await copyFile(
        resolve(extensionRoot, "manifest.json"),
        resolve(buildOutputDirectory, "manifest.json"),
      );
      await Promise.all(
        SHARED_CONTENT_ASSETS.map((asset) =>
          copyFile(resolve(extensionRoot, `pages/${asset}`), resolve(buildOutputDirectory, asset)),
        ),
      );
    },
  };
}

function copyPageAssets(page: "options" | "popup"): Plugin {
  let pageOutputDirectory = outputDirectory;
  return {
    name: "copy-store-options-assets",
    configResolved(config) {
      pageOutputDirectory = config.build.outDir;
    },
    async closeBundle() {
      await mkdir(pageOutputDirectory, { recursive: true });
      await Promise.all(
        PAGE_ASSETS[page].map((asset) =>
          copyFile(resolve(extensionRoot, `pages/${asset}`), resolve(pageOutputDirectory, asset)),
        ),
      );
    },
  };
}

export function createStoreExtensionConfig(mode: string): UserConfig {
  const isContentBuild = mode === "content";
  const isOptionsBuild = mode === "options";
  const isPopupBuild = mode === "popup";
  const isYouTubeContentBuild = mode === "youtube-content";
  const isYouTubeMainBuild = mode === "youtube-main";
  return {
    build: {
      emptyOutDir: isContentBuild,
      minify: "esbuild",
      outDir: outputDirectory,
      rollupOptions: {
        input: resolve(
          extensionRoot,
          isContentBuild
            ? "src/content/content-script.ts"
            : isYouTubeContentBuild
              ? "src/content/youtube/youtube-content-entry.ts"
              : isYouTubeMainBuild
                ? "src/content/youtube/youtube-main-entry.ts"
                : isOptionsBuild
                  ? "src/options/options-entry.ts"
                  : isPopupBuild
                    ? "src/popup/popup-entry.ts"
                    : "src/service-worker/service-worker.ts",
        ),
        output: {
          entryFileNames: isContentBuild
            ? "content-script.js"
            : isYouTubeContentBuild
              ? "youtube-content.js"
              : isYouTubeMainBuild
                ? "youtube-main.js"
                : isOptionsBuild
                  ? "options.js"
                  : isPopupBuild
                    ? "popup.js"
                    : "service-worker.js",
          format: isContentBuild || isYouTubeContentBuild || isYouTubeMainBuild ? "iife" : "es",
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      target: "chrome120",
    },
    plugins: isContentBuild
      ? []
      : isOptionsBuild
        ? [copyPageAssets("options")]
        : isPopupBuild
          ? [copyPageAssets("popup")]
          : [copyManifest()],
  };
}

export default defineConfig(({ mode }) => createStoreExtensionConfig(mode));
