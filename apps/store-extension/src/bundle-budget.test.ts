// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { build } from "vite";

import { createStoreExtensionConfig } from "../vite.config.js";

// The former 48 KiB ClassicParity baseline covered static structured ResultCards, the loading
// shell, and lexicon reconciliation. The reviewed 52 KiB v4 baseline additionally covers strict
// typed structured-stream parsing, stable incremental section patching, and partial-error
// retention. The reviewed 55 KiB Phase 27 baseline adds only the current-card StudyCapture
// controls and fixed Web-workspace entry. The reviewed 56 KiB C/G/H/I baseline additionally
// carries one strict appearance field and in-place Shadow DOM appearance updates. The reviewed
// 58.25 KiB readability baseline adds text-preserving main-structure clauses and emphasis, stable
// streamed placement, and the short-viewport reading fallback. A shared scan and placement state
// reduce this candidate from 59,870 to 59,508 bytes, leaving 140 bytes at review. It must still
// exclude Zod, Provider, and Worker modules.
const CONTENT_SCRIPT_BASELINE_BYTES = 58.25 * 1_024;
// The former 55.25 KiB YouTube controller budget covered caption interaction, pause ownership,
// overlayTheme, and the shared ActionCard. The reviewed 64 KiB ClassicParity baseline includes
// the same static ResultCard and lexicon lifecycle modules now shared with ordinary pages. The
// reviewed 68 KiB v4 baseline additionally carries the strict structured-stream parser and
// partial-error behavior. The reviewed 72 KiB Phase 27 baseline adds the same current-card
// StudyCapture controls and fixed Web-workspace entry. The reviewed 74 KiB C/G/H/I baseline adds
// strict appearance propagation plus the four local high-contrast control-edge treatments. The
// reviewed 76 KiB readability baseline carries the same shared main-structure and placement
// behavior; equivalent deduplication reduces 77,930 to 77,568 bytes, leaving 256 bytes at review.
// It remains isolated and must not admit Zod, Provider, or Worker code.
const YOUTUBE_CONTENT_BASELINE_BYTES = 76 * 1_024;
const YOUTUBE_MAIN_BASELINE_BYTES = 24 * 1_024;
const POPUP_BASELINE_BYTES = 32 * 1_024;

describe("Store extension bundle budget", () => {
  it("keeps the interactive all-sites script below the reviewed baseline", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "huayi-store-bundle-"));
    try {
      const config = createStoreExtensionConfig("content");
      await build({
        ...config,
        build: { ...config.build, outDir: outputDirectory },
        configFile: false,
      });
      const contentScript = await readFile(join(outputDirectory, "content-script.js"));

      expect(contentScript.byteLength).toBeLessThanOrEqual(CONTENT_SCRIPT_BASELINE_BYTES);
      const source = contentScript.toString("utf8");
      expect(source).not.toContain("zod");
      expect(source).not.toContain("ProductionAnalysisEngine");
      expect(source).not.toContain("service-worker");
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });

  it("keeps the host-loaded YouTube isolated controller below its separate budget", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "huayi-store-youtube-content-"));
    try {
      const config = createStoreExtensionConfig("youtube-content");
      await build({
        ...config,
        build: { ...config.build, outDir: outputDirectory },
        configFile: false,
      });
      const controller = await readFile(join(outputDirectory, "youtube-content.js"));

      expect(controller.byteLength).toBeLessThanOrEqual(YOUTUBE_CONTENT_BASELINE_BYTES);
      const source = controller.toString("utf8");
      expect(source).not.toContain("zod");
      expect(source).not.toContain("ProductionAnalysisEngine");
      expect(source).not.toContain("service-worker");
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });

  it("keeps the isolated MAIN bridge below its separate reviewed budget", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "huayi-store-youtube-main-"));
    try {
      const config = createStoreExtensionConfig("youtube-main");
      await build({
        ...config,
        build: { ...config.build, outDir: outputDirectory },
        configFile: false,
      });
      const bridge = await readFile(join(outputDirectory, "youtube-main.js"));

      expect(bridge.byteLength).toBeLessThanOrEqual(YOUTUBE_MAIN_BASELINE_BYTES);
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });

  it("keeps the non-secret native-DOM popup below its reviewed budget", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "huayi-store-popup-"));
    try {
      const config = createStoreExtensionConfig("popup");
      await build({
        ...config,
        build: { ...config.build, outDir: outputDirectory },
        configFile: false,
      });
      const popup = await readFile(join(outputDirectory, "popup.js"));

      expect(popup.byteLength).toBeLessThanOrEqual(POPUP_BASELINE_BYTES);
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });
});
