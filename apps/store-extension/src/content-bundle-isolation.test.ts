// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStoreExtensionConfig } from "../vite.config.js";
import { BUILD_FIXTURE_TIMEOUT_MS } from "./build-fixture.test-support.js";

describe.each(["content", "popup"])("%s bundle isolation", (mode) => {
  let outDir: string;
  const modules: string[] = [];
  // Real compilation has a setup deadline; bundle assertions keep the default test deadline.
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "huayi-content-isolation-"));
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
  }, BUILD_FIXTURE_TIMEOUT_MS);
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it("keeps schema and Shanbay page code out of the bundle", () => {
    expect(modules.some((path) => /[/\\]zod[/\\]/u.test(path))).toBe(false);
    expect(modules.some((path) => path.includes("backfill-page-controller"))).toBe(false);
    if (mode === "content") expect(modules.some((path) => path.includes("/backfill/"))).toBe(false);
  });
});
