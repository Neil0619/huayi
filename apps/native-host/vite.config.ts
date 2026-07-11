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
  return {
    build: {
      emptyOutDir: !isInstallerBuild,
      minify: false,
      outDir: outputDirectory,
      rollupOptions: {
        input: resolve(hostRoot, isInstallerBuild ? "src/install/cli.ts" : "src/main.ts"),
        output: {
          entryFileNames: isInstallerBuild ? "install/cli.js" : "main.js",
          format: "es" as const,
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      ssr: true,
      target: "node18",
    },
    plugins: isInstallerBuild ? [] : [copyProviderSchemas()],
    ssr: {
      noExternal: true,
    },
  };
}

export default defineConfig(({ mode }) => createNativeHostConfig(mode));
