// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HUAYI_VISUAL_SIGNATURE,
  STORE_OVERLAY_FALLBACK_STYLES,
} from "./content/overlay/overlay-styles.js";

const root = "apps/store-extension";

function page(name: string): string {
  return readFileSync(`${root}/pages/${name}`, "utf8");
}

describe("Huayi Store visual contract", () => {
  it("keeps Options, Popup, and Overlay on the same cold editorial brand signature", () => {
    const brandTheme = page("brand-theme.css");

    expect(brandTheme).toContain(`--hv: "${HUAYI_VISUAL_SIGNATURE}"`);
    expect(page("overlay.css")).toContain("#101a2d");
    expect(page("overlay.css")).toContain("#5878a8");
    expect(page("overlay.css")).toContain("#8f82bd");
    expect(page("options.css")).toContain('@import "./brand-theme.css"');
    expect(page("popup.css")).toContain('@import "./brand-theme.css"');
  });

  it("renders the restrained prism brand mark on every primary surface", () => {
    expect(page("options.html")).toContain("data-brand-mark");
    expect(page("popup.html")).toContain("data-brand-mark");
    expect(page("overlay.css")).toContain(".brand-mark");
  });

  it("keeps the former warm parchment palette isolated to the selectable theme", () => {
    for (const warmColor of ["#fffdf8", "#d9d1c2", "#f4eee4", "#a84f34"]) {
      expect(page("overlay.css").toLowerCase()).toContain(warmColor);
    }
    expect(page("overlay.css")).toContain('.panel[data-theme="parchment"]');
    expect(STORE_OVERLAY_FALLBACK_STYLES).toContain("min-height:40px");
  });

  it("keeps raw palette values out of page component styles and semantic aliases", () => {
    for (const stylesheet of ["options.css", "options-components.css", "popup.css"]) {
      expect(page(stylesheet)).not.toMatch(/#[\da-f]{3,8}\b/iu);
    }

    const semanticTokens = page("brand-theme.css")
      .split("/* Semantic tokens */")[1]
      ?.split("/* Component tokens */")[0];
    expect(semanticTokens).toBeDefined();
    expect(semanticTokens).not.toMatch(/#[\da-f]{3,8}\b/iu);
  });
});
