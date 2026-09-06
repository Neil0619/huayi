import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin, type UserConfig } from "vite";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const workspaceAliases = {
  "@huayi/cloud-contracts": resolve(extensionRoot, "../../packages/cloud-contracts/src/index.ts"),
  "@huayi/learning-domain": resolve(extensionRoot, "../../packages/learning-domain/src/index.ts"),
  "@huayi/store-domain": resolve(extensionRoot, "../../packages/store-domain/src/index.ts"),
};
const PAGE_ASSETS = {
  options: [
    "options.html",
    "options.css",
    "options-components.css",
    "brand-theme.css",
    "page-ui.css",
    "options-site-rules.css",
  ],
  popup: ["popup.html", "popup.css", "brand-theme.css", "page-ui.css"],
} as const;
const SHARED_CONTENT_ASSETS = ["overlay.css"] as const;
const buildProfiles = {
  release: {
    apiOrigin: null,
    webOrigin: null,
    directory: "dist-release",
    manifest: "manifest.json",
  },
  "hosted-acceptance": {
    apiOrigin: "https://api.acceptance.seen-said.cn",
    webOrigin: "https://app.acceptance.seen-said.cn",
    directory: "dist",
    manifest: "manifest.hosted-acceptance.json",
  },
  production: {
    apiOrigin: "https://api.seen-said.cn",
    webOrigin: "https://app.seen-said.cn",
    directory: "dist-production",
    manifest: "manifest.production.json",
  },
} as const;
type StoreBuildProfile = keyof typeof buildProfiles;

function storeBuildProfile(value: string | undefined): StoreBuildProfile {
  if (value === undefined || value === "release") return "release";
  if (value === "hosted-acceptance" || value === "production") return value;
  throw new Error("Store Extension build profile is invalid.");
}

function copyManifest(buildProfile: StoreBuildProfile, outputDirectory: string): Plugin {
  let buildOutputDirectory = outputDirectory;
  return {
    name: "copy-store-manifest",
    configResolved(config) {
      buildOutputDirectory = config.build.outDir;
    },
    async closeBundle() {
      await mkdir(buildOutputDirectory, { recursive: true });
      await copyFile(
        resolve(extensionRoot, buildProfiles[buildProfile].manifest),
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

function copyPageAssets(page: "options" | "popup", outputDirectory: string): Plugin {
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

export function createStoreExtensionConfig(
  mode: string,
  requestedBuildProfile?: string,
): UserConfig {
  const buildProfile = storeBuildProfile(
    requestedBuildProfile ?? process.env.HUAYI_STORE_BUILD_PROFILE,
  );
  // Keep the paired hosted install at its existing path; offline builds must never replace it.
  const profile = buildProfiles[buildProfile];
  const outputDirectory = resolve(extensionRoot, profile.directory);
  const isContentBuild = mode === "content";
  const isOptionsBuild = mode === "options";
  const isPopupBuild = mode === "popup";
  const isYouTubeContentBuild = mode === "youtube-content";
  const isYouTubeMainBuild = mode === "youtube-main";
  return {
    define: {
      HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE: JSON.stringify(profile.apiOrigin),
      HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE: JSON.stringify(
        profile.webOrigin === null ? null : `${profile.webOrigin}/app`,
      ),
      HUAYI_WEB_ORIGIN_BUILD_VALUE: JSON.stringify(profile.webOrigin),
    },
    resolve: {
      alias: workspaceAliases,
    },
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
        ? [copyPageAssets("options", outputDirectory)]
        : isPopupBuild
          ? [copyPageAssets("popup", outputDirectory)]
          : [copyManifest(buildProfile, outputDirectory)],
  };
}

export default defineConfig(({ mode }) => createStoreExtensionConfig(mode));
