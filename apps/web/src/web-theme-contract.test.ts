// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles.css", "utf8");

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

function themeBlock(appearance: (typeof appearances)[number]): string {
  const match = new RegExp(
    `:root\\[data-appearance=["']${appearance}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
    "u",
  ).exec(styles);
  if (match?.[1] === undefined) throw new Error(`Missing ${appearance} theme block.`);
  return match[1];
}

function customProperties(block: string): Map<string, string> {
  return new Map(
    Array.from(block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gimu), ([, name, value]) => {
      if (name === undefined || value === undefined) throw new Error("Invalid theme token.");
      return [name, value.trim()];
    }),
  );
}

describe("Web appearance theme contract", () => {
  it("keeps every appearance on the same semantic registry", () => {
    const expected = semanticTokens.map((token) => `--${token}`).sort();

    for (const appearance of appearances) {
      expect([...customProperties(themeBlock(appearance)).keys()].sort(), appearance).toEqual(
        expected,
      );
    }
  });

  it("locks the approved C and G reverse colors", () => {
    expect(customProperties(themeBlock("moon")).get("--action")).toBe("#29394b");
    expect(customProperties(themeBlock("silver")).get("--action")).toBe("#24282d");
  });

  it("keeps silver as the pre-mount and CSS fallback appearance", () => {
    expect(styles).toContain("/* Default appearance: silver / 流银镜白 */");
    expect(styles).toMatch(/:root\s*\{[\s\S]*?--action:\s*#24282d;/u);
  });

  it("provides readable solid and forced-color glass fallbacks", () => {
    expect(styles).toContain("@supports not (backdrop-filter: blur(1px))");
    expect(styles).toContain("@media (forced-colors: active)");
  });
});
