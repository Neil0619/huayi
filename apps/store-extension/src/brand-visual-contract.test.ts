// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HUAYI_VISUAL_SIGNATURE,
  STORE_OVERLAY_FALLBACK_STYLES,
} from "./content/overlay/overlay-styles.js";

const root = "apps/store-extension";
const appearances = ["moon", "silver", "champagne", "porcelain"] as const;
const semanticTokens = [
  "surface-canvas-solid",
  "surface-canvas",
  "surface-glass",
  "surface-glass-strong",
  "surface-glass-soft",
  "surface-inner",
  "surface-input",
  "surface-hover",
  "text-primary",
  "text-secondary",
  "text-muted",
  "text-on-action",
  "accent",
  "accent-soft",
  "action",
  "action-hover",
  "border-glass",
  "border-inner",
  "border-strong",
  "focus-ring",
  "shadow-glass",
  "shadow-control",
] as const;

function page(name: string): string {
  return readFileSync(`${root}/pages/${name}`, "utf8");
}

function block(source: string, selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "u").exec(source);
  if (match?.[1] === undefined) throw new Error(`Missing CSS block: ${selector}`);
  return match[1];
}

function themeBlock(source: string, appearance: (typeof appearances)[number]): string {
  return block(source, `:root\\[data-appearance=["']${appearance}["']\\]`);
}

function properties(source: string): Map<string, string> {
  return new Map(
    Array.from(source.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gimu), ([, name, value]) => {
      if (name === undefined || value === undefined) throw new Error("Invalid CSS property.");
      return [name, value.trim()];
    }),
  );
}

describe("语见 Store visual contract", () => {
  it("keeps Options and Popup on the v3 four-appearance registry", () => {
    const theme = page("brand-theme.css");
    const expected = semanticTokens.map((token) => `--${token}`).sort();

    expect(theme).toContain(`--hv: "${HUAYI_VISUAL_SIGNATURE}"`);
    expect(page("options.css")).toContain('@import "./brand-theme.css"');
    expect(page("popup.css")).toContain('@import "./brand-theme.css"');
    for (const appearance of appearances) {
      expect([...properties(themeBlock(theme, appearance)).keys()].sort(), appearance).toEqual(
        expected,
      );
    }
  });

  it("locks C to deep navy, G to graphite, and removes the old cyan-violet palette", () => {
    const theme = page("brand-theme.css");
    expect(properties(themeBlock(theme, "moon")).get("--action")).toBe("#29394b");
    expect(properties(themeBlock(theme, "silver")).get("--action")).toBe("#24282d");
    for (const stylesheet of ["brand-theme.css", "overlay.css", "options.css", "popup.css"]) {
      expect(page(stylesheet).toLowerCase()).not.toMatch(/#(?:5878a8|8f82bd|625f95)\b/u);
    }
  });

  it("keeps pearl and parchment as material-only variants of every appearance", () => {
    const overlay = page("overlay.css");
    for (const appearance of appearances) {
      expect(overlay).toContain(`.panel[data-appearance="${appearance}"]`);
    }
    for (const material of ["pearl", "parchment"]) {
      const keys = [...properties(block(overlay, `.panel\\[data-theme="${material}"\\]`)).keys()];
      expect(keys.length, material).toBeGreaterThan(0);
      expect(
        keys.every((key) => key.startsWith("--material-")),
        material,
      ).toBe(true);
    }
    expect(STORE_OVERLAY_FALLBACK_STYLES).toContain("min-height:40px");
  });

  it("renders the local glass brand mark on every primary surface", () => {
    expect(page("options.html")).toContain("data-brand-mark");
    expect(page("popup.html")).toContain("data-brand-mark");
    expect(page("brand-theme.css")).toContain(".brand-mark");
    expect(page("overlay.css")).toContain(".brand-mark");
  });

  it("keeps theme palette literals out of page component styles", () => {
    for (const stylesheet of ["options.css", "options-components.css", "popup.css"]) {
      expect(page(stylesheet)).not.toMatch(/#[\da-f]{3,8}\b|\brgb\(/iu);
    }
  });
});
