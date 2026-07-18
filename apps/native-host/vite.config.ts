import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import type { Plugin, UserConfig } from "vite";

const hostRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(hostRoot, "dist");

function copyProviderSchemas(): Plugin {
  return {
    name: "copy-provider-schemas",
    async closeBundle() {
      const destination = resolve(outputDirectory, "provider/schemas");
      await mkdir(destination, { recursive: true });
      await cp(resolve(hostRoot, "src/provider/schemas"), destination, { recursive: true });
    },
  };
}

function copyWindowsCredentialHelper(): Plugin {
  return {
    name: "copy-windows-credential-helper",
    async closeBundle() {
      const destination = resolve(outputDirectory, "windows/deepseek-credential.ps1");
      await mkdir(dirname(destination), { recursive: true });
      await cp(resolve(hostRoot, "src/install/windows-deepseek-credential.ps1"), destination);
    },
  };
}

export function createNativeHostConfig(mode: string): UserConfig {
  const isInstallerBuild = mode === "installer";
  const isDiagnosticsBuild = mode === "diagnostics";
  const isCompatibleSmokeBuild = mode === "compatible-smoke";
  const isDeepSeekSmokeBuild = mode === "deepseek-smoke";
  const isWindowsSeaBuild = mode === "windows-sea";
  const input = isInstallerBuild
    ? "src/install/cli.ts"
    : isDiagnosticsBuild
      ? "src/diagnostics/compare-providers.ts"
      : isCompatibleSmokeBuild
        ? "src/diagnostics/run-compatible-smoke.ts"
        : isDeepSeekSmokeBuild
          ? "src/diagnostics/run-deepseek-smoke.ts"
          : isWindowsSeaBuild
            ? "src/windows-entrypoint.ts"
            : "src/main-entrypoint.ts";
  const entryFileNames = isInstallerBuild
    ? "install/cli.js"
    : isDiagnosticsBuild
      ? "diagnostics/compare-providers.js"
      : isCompatibleSmokeBuild
        ? "diagnostics/run-compatible-smoke.js"
        : isDeepSeekSmokeBuild
          ? "diagnostics/run-deepseek-smoke.js"
          : isWindowsSeaBuild
            ? "windows/sea-main.cjs"
            : "main.js";
  const isSecondaryBuild =
    isInstallerBuild ||
    isDiagnosticsBuild ||
    isCompatibleSmokeBuild ||
    isDeepSeekSmokeBuild ||
    isWindowsSeaBuild;
  return {
    build: {
      emptyOutDir: !isSecondaryBuild,
      minify: false,
      outDir: outputDirectory,
      rollupOptions: {
        input: resolve(hostRoot, input),
        output: {
          entryFileNames,
          format: isWindowsSeaBuild ? ("cjs" as const) : ("es" as const),
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      ssr: true,
      target: "node18",
    },
    plugins: isWindowsSeaBuild
      ? [copyWindowsCredentialHelper()]
      : isSecondaryBuild
        ? []
        : [copyProviderSchemas()],
    ssr: {
      noExternal: true,
    },
  };
}

export default defineConfig(({ mode }) => createNativeHostConfig(mode));
