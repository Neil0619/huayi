import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import type { Plugin } from "vite";

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

export function createNativeHostConfig() {
  return {
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: outputDirectory,
      rollupOptions: {
        input: resolve(hostRoot, "src/main.ts"),
        output: {
          entryFileNames: "main.js",
          format: "es" as const,
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      ssr: true,
      target: "node18",
    },
    plugins: [copyProviderSchemas()],
    ssr: {
      noExternal: true,
    },
  };
}

export default defineConfig(createNativeHostConfig());
