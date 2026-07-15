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

export function createNativeHostConfig(mode: string): UserConfig {
  const isInstallerBuild = mode === "installer";
  const isDiagnosticsBuild = mode === "diagnostics";
  const isCompatibleSmokeBuild = mode === "compatible-smoke";
  const input = isInstallerBuild
    ? "src/install/cli.ts"
    : isDiagnosticsBuild
      ? "src/diagnostics/compare-providers.ts"
      : isCompatibleSmokeBuild
        ? "src/diagnostics/run-compatible-smoke.ts"
        : "src/main.ts";
  const entryFileNames = isInstallerBuild
    ? "install/cli.js"
    : isDiagnosticsBuild
      ? "diagnostics/compare-providers.js"
      : isCompatibleSmokeBuild
        ? "diagnostics/run-compatible-smoke.js"
        : "main.js";
  const isSecondaryBuild = isInstallerBuild || isDiagnosticsBuild || isCompatibleSmokeBuild;
  return {
    build: {
      emptyOutDir: !isSecondaryBuild,
      minify: false,
      outDir: outputDirectory,
      rollupOptions: {
        input: resolve(hostRoot, input),
        output: {
          entryFileNames,
          format: "es" as const,
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      ssr: true,
      target: "node18",
    },
    plugins: isSecondaryBuild ? [] : [copyProviderSchemas()],
    ssr: {
      noExternal: true,
    },
  };
}

export default defineConfig(({ mode }) => createNativeHostConfig(mode));
