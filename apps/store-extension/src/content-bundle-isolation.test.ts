// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import { createStoreExtensionConfig } from "../vite.config.js";

it.each(["content", "popup"])("keeps %s free of schema and Shanbay page code", async (mode) => {
  const outDir = await mkdtemp(join(tmpdir(), "huayi-content-isolation-"));
  const modules: string[] = [];
  try {
    const config = createStoreExtensionConfig(mode);
    await build({
      ...config,
      configFile: false,
      build: { ...config.build, outDir },
      plugins: [
        ...(config.plugins ?? []),
        {
          name: "inspect-bundled-modules",
          generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
              if (chunk.type === "chunk") modules.push(...Object.keys(chunk.modules));
            }
          },
        },
      ],
    });
    expect(modules.some((path) => /[/\\]zod[/\\]/u.test(path))).toBe(false);
    expect(modules.some((path) => path.includes("backfill-page-controller"))).toBe(false);
    if (mode === "content") expect(modules.some((path) => path.includes("/backfill/"))).toBe(false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
