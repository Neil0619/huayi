import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const output = fileURLToPath(new URL("../artifacts/asbplayer-m0-probe/", import.meta.url));
const entry = fileURLToPath(
  new URL(
    "../apps/store-extension/src/content/asbplayer/asbplayer-probe-entry.ts",
    import.meta.url,
  ),
);

// Separate artifact only: never reads or changes Store build profiles, manifests or installed output.
await build({
  configFile: false,
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: output,
    target: "chrome120",
    sourcemap: false,
    rollupOptions: {
      input: entry,
      output: { entryFileNames: "probe.js", format: "iife", inlineDynamicImports: true },
    },
  },
});
await mkdir(output, { recursive: true });
await writeFile(
  new URL("../artifacts/asbplayer-m0-probe/manifest.json", import.meta.url),
  `${JSON.stringify(
    {
      manifest_version: 3,
      name: "语见 asbplayer M0 验证探针",
      version: "0.0.1",
      description: "仅用于官方播放器的本地计数及暂停/播放验证。",
      content_scripts: [
        {
          matches: ["https://app.asbplayer.dev/*"],
          js: ["probe.js"],
          run_at: "document_start",
          all_frames: true,
          world: "MAIN",
        },
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(
  "M0 probe built in artifacts/asbplayer-m0-probe. No browser or installation was started.",
);
