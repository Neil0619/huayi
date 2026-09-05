// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const popupStyles = readFileSync("apps/store-extension/pages/popup.css", "utf8");
const overlayStyles = readFileSync("apps/store-extension/pages/overlay.css", "utf8");
const optionsStyles = readFileSync("apps/store-extension/pages/options.css", "utf8");
const overlayFallbackStyles = readFileSync(
  "apps/store-extension/src/content/overlay/overlay-styles.ts",
  "utf8",
);
const optionsEntry = readFileSync("apps/store-extension/src/options/options-entry.ts", "utf8");

function block(source: string, selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "isu").exec(source);
  if (match?.[1] === undefined) throw new Error(`Missing CSS block: ${selector}`);
  return match[1];
}

function firstPixels(source: string, property: string): number {
  const match = new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`, "iu").exec(source);
  if (match?.[1] === undefined) throw new Error(`Missing pixel ${property} declaration.`);
  return Number(match[1]);
}

describe("Store UI QA contract", () => {
  it("lets the narrow popup reflow without forced overflow or empty height", () => {
    const body = block(popupStyles, "body");

    expect(body).toMatch(/width:\s*340px/iu);
    expect(body).toMatch(/min-width:\s*340px/iu);
    expect(body).not.toMatch(/min-height:/iu);
    expect(popupStyles).toMatch(
      /\.popup-header\s*\{[^}]*(?:flex-wrap:\s*wrap|grid-template-columns:)/isu,
    );
    expect(popupStyles).toMatch(
      /\.outbox-row\s*\{[^}]*(?:flex-wrap:\s*wrap|grid-template-columns:)/isu,
    );
  });

  it("uses readable popup summary type without oversized tracking", () => {
    const summary = block(popupStyles, "\\.analysis-summary");
    const label = block(popupStyles, "\\.section-label");

    expect(firstPixels(summary, "font-size")).toBeGreaterThanOrEqual(14);
    expect(summary).toMatch(/white-space:\s*nowrap/iu);
    expect(summary).not.toMatch(/text-overflow:\s*ellipsis/iu);
    const tracking = /letter-spacing:\s*(\d+(?:\.\d+)?)em/iu.exec(label)?.[1];
    expect(tracking).toBeDefined();
    expect(Number(tracking)).toBeLessThanOrEqual(0.08);
    expect(block(popupStyles, "\\.popup-brand > div")).toMatch(/min-width:\s*0/iu);
  });

  it("uses the approved local font stack across Store surfaces", () => {
    for (const styles of [popupStyles, optionsStyles, overlayStyles, overlayFallbackStyles]) {
      expect(styles).toContain('"Avenir Next"');
      expect(styles).toContain('"PingFang SC"');
    }
  });

  it("uses dynamic viewport height for the overlay panel", () => {
    const panel = block(overlayStyles, "\\.panel");

    expect(panel).toMatch(/max-height:\s*(?:min\([^;]*100dvh|calc\([^;]*100dvh)/iu);
  });

  it("uses a dense result rhythm", () => {
    const heading = block(overlayStyles, "\\.result-heading");
    const section = block(overlayStyles, "\\.result-section");
    const list = block(overlayStyles, "\\.result-section ul");

    expect(firstPixels(heading, "padding")).toBeLessThanOrEqual(10);
    expect(firstPixels(section, "padding")).toBeLessThanOrEqual(10);
    expect(firstPixels(list, "gap")).toBeLessThanOrEqual(6);
    expect(block(overlayStyles, "\\.panel")).toMatch(/width:\s*min\(3[5-8]\dpx/iu);
    expect(block(overlayStyles, '\\[data-result-layout="pairs"\\] \\.result-entry')).toMatch(
      /minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/iu,
    );
  });

  it("opens cloud login through the versioned parameter-free worker command", () => {
    expect(optionsEntry).toContain('type: "store/open-web-workspace"');
    expect(optionsEntry).toContain("messageVersion: STORE_MESSAGE_VERSION");
    expect(optionsEntry).not.toMatch(/webWorkspaceUrl|HUAYI_WEB_WORKSPACE_URL/u);
  });
});
