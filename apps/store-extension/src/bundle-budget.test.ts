// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

import { BUILD_FIXTURE_TIMEOUT_MS } from "./build-fixture.test-support.js";
import { createStoreExtensionConfig } from "../vite.config.js";

// The former 48 KiB ClassicParity baseline covered static structured ResultCards, the loading
// shell, and lexicon reconciliation. The reviewed 52 KiB v4 baseline additionally covers strict
// typed structured-stream parsing, stable incremental section patching, and partial-error
// retention. The reviewed 55 KiB Phase 27 baseline adds only the current-card StudyCapture
// controls and fixed Web-workspace entry. The reviewed 56 KiB C/G/H/I baseline additionally
// carries one strict appearance field and in-place Shadow DOM appearance updates. The reviewed
// 58.5 KiB readability baseline adds primary clauses, focus-preserving disclosure, stable streamed
// placement and short-viewport fallback. The restored package is 59,701 bytes, including 63 bytes
// to reposition after disclosure toggles; the 59,904-byte budget leaves 203 bytes. It must still
// exclude Zod, Provider, and Worker modules.
const CONTENT_SCRIPT_BASELINE_BYTES = 58.5 * 1_024;
// The former 55.25 KiB YouTube controller budget covered caption interaction, pause ownership,
// overlayTheme, and the shared ActionCard. The reviewed 64 KiB ClassicParity baseline includes
// the same static ResultCard and lexicon lifecycle modules now shared with ordinary pages. The
// reviewed 68 KiB v4 baseline additionally carries the strict structured-stream parser and
// partial-error behavior. The reviewed 72 KiB Phase 27 baseline adds the same current-card
// StudyCapture controls and fixed Web-workspace entry. The reviewed 74 KiB C/G/H/I baseline adds
// strict appearance propagation plus the four local high-contrast control-edge treatments. The
// reviewed 76 KiB readability baseline carries the same shared main-structure and placement
// behavior; the restored package including disclosure repositioning is 77,761 bytes, leaving 63.
// It remains isolated and must not admit Zod, Provider, or Worker code.
const YOUTUBE_CONTENT_BASELINE_BYTES = 76 * 1_024;
const YOUTUBE_MAIN_BASELINE_BYTES = 24 * 1_024;
const POPUP_BASELINE_BYTES = 32 * 1_024;

describe("Store extension bundle budget", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "huayi-store-budgets-"));
  });
  for (const mode of ["content", "youtube-content", "youtube-main", "popup"]) {
    beforeAll(async () => {
      const config = createStoreExtensionConfig(mode);
      await build({
        ...config,
        build: { ...config.build, outDir: join(directory, mode) },
        configFile: false,
      });
    }, BUILD_FIXTURE_TIMEOUT_MS);
  }
  afterAll(async () => {
    if (directory) await rm(directory, { force: true, recursive: true });
  });
  it("keeps the interactive all-sites script below the reviewed baseline", async () => {
    const outputDirectory = join(directory, "content");
    const contentScript = await readFile(join(outputDirectory, "content-script.js"));

    expect(contentScript.byteLength).toBeLessThanOrEqual(CONTENT_SCRIPT_BASELINE_BYTES);
    const source = contentScript.toString("utf8");
    expect(source).not.toContain("zod");
    expect(source).not.toContain("ProductionAnalysisEngine");
    expect(source).not.toContain("service-worker");
  });

  it("keeps the host-loaded YouTube isolated controller below its separate budget", async () => {
    const outputDirectory = join(directory, "youtube-content");
    const controller = await readFile(join(outputDirectory, "youtube-content.js"));

    expect(controller.byteLength).toBeLessThanOrEqual(YOUTUBE_CONTENT_BASELINE_BYTES);
    const source = controller.toString("utf8");
    expect(source).not.toContain("zod");
    expect(source).not.toContain("ProductionAnalysisEngine");
    expect(source).not.toContain("service-worker");
  });

  it("keeps the isolated MAIN bridge below its separate reviewed budget", async () => {
    const outputDirectory = join(directory, "youtube-main");
    const bridge = await readFile(join(outputDirectory, "youtube-main.js"));

    expect(bridge.byteLength).toBeLessThanOrEqual(YOUTUBE_MAIN_BASELINE_BYTES);
  });

  it("keeps the non-secret native-DOM popup below its reviewed budget", async () => {
    const outputDirectory = join(directory, "popup");
    const popup = await readFile(join(outputDirectory, "popup.js"));

    expect(popup.byteLength).toBeLessThanOrEqual(POPUP_BASELINE_BYTES);
  });
});
