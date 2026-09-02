// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles.css", "utf8");
const appearances = ["moon", "silver", "champagne", "porcelain"] as const;
type Appearance = (typeof appearances)[number];

interface Color {
  readonly alpha: number;
  readonly blue: number;
  readonly green: number;
  readonly red: number;
}

function blockProperties(block: string): ReadonlyMap<string, string> {
  return new Map(
    Array.from(block.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gimu), ([, name, value]) => {
      if (name === undefined || value === undefined) throw new Error("Invalid color token.");
      return [name, value.trim()];
    }),
  );
}

const rootBlock = /:root\s*\{([\s\S]*?)\n\}/u.exec(styles)?.[1];
if (rootBlock === undefined) throw new Error("Missing root token registry.");
const rootProperties = blockProperties(rootBlock);

function appearanceProperties(appearance: Appearance): ReadonlyMap<string, string> {
  const block = new RegExp(
    `:root\\[data-appearance=["']${appearance}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
    "u",
  ).exec(styles)?.[1];
  if (block === undefined) throw new Error(`Missing ${appearance} token registry.`);
  return blockProperties(block);
}

function tokenValue(appearance: Appearance, name: string): string {
  const value = appearanceProperties(appearance).get(name) ?? rootProperties.get(name);
  if (value === undefined) throw new Error(`Missing color token: --${name}`);
  return value;
}

function parseColor(value: string): Color {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value)?.[1];
  if (hex !== undefined) {
    return {
      alpha: 1,
      blue: Number.parseInt(hex.slice(4, 6), 16),
      green: Number.parseInt(hex.slice(2, 4), 16),
      red: Number.parseInt(hex.slice(0, 2), 16),
    };
  }
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%\)$/u.exec(value);
  if (
    rgb?.[1] === undefined ||
    rgb[2] === undefined ||
    rgb[3] === undefined ||
    rgb[4] === undefined
  ) {
    throw new Error(`Unsupported color token value: ${value}`);
  }
  return {
    alpha: Number(rgb[4]) / 100,
    blue: Number(rgb[3]),
    green: Number(rgb[2]),
    red: Number(rgb[1]),
  };
}

function resolveColor(appearance: Appearance, name: string): Color {
  const value = tokenValue(appearance, name);
  const reference = /^var\(--([a-z0-9-]+)\)$/u.exec(value)?.[1];
  return reference === undefined ? parseColor(value) : resolveColor(appearance, reference);
}

function composite(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  const channel = (front: number, back: number) =>
    (front * foreground.alpha + back * background.alpha * (1 - foreground.alpha)) / alpha;
  return {
    alpha,
    blue: channel(foreground.blue, background.blue),
    green: channel(foreground.green, background.green),
    red: channel(foreground.red, background.red),
  };
}

function opaqueToken(appearance: Appearance, name: string): Color {
  const color = resolveColor(appearance, name);
  return color.alpha === 1
    ? color
    : composite(color, resolveColor(appearance, "surface-canvas-solid"));
}

function linearChannel(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Color): number {
  return (
    0.2126 * linearChannel(color.red) +
    0.7152 * linearChannel(color.green) +
    0.0722 * linearChannel(color.blue)
  );
}

function contrast(first: Color, second: Color): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

const lightSurfaces = [
  "surface-canvas-solid",
  "surface-input",
  "surface-inner",
  "surface-hover",
  "danger-surface",
] as const;

describe("Web semantic color accessibility", () => {
  it("keeps normal text tokens at WCAG AA contrast on every light surface", () => {
    for (const appearance of appearances) {
      for (const foreground of [
        "text-primary",
        "text-secondary",
        "text-muted",
        "danger-text",
        "action",
        "action-hover",
      ] as const) {
        for (const background of lightSurfaces) {
          expect(
            contrast(opaqueToken(appearance, foreground), opaqueToken(appearance, background)),
            `${appearance}: ${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(opaqueToken(appearance, "text-on-action"), opaqueToken(appearance, "action")),
        `${appearance}: text-on-action on action`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus ring distinguishable from every light surface", () => {
    for (const appearance of appearances) {
      for (const background of lightSurfaces) {
        expect(
          contrast(opaqueToken(appearance, "focus-ring"), opaqueToken(appearance, background)),
          `${appearance}: focus-ring on ${background}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
