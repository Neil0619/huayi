// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles.css", "utf8");

interface Color {
  readonly alpha: number;
  readonly blue: number;
  readonly green: number;
  readonly red: number;
}

function tokenValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`, "u").exec(styles);
  if (match?.[1] === undefined) throw new Error(`Missing color token: --${name}`);
  return match[1].trim();
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

function resolveColor(name: string): Color {
  const value = tokenValue(name);
  const reference = /^var\(--([a-z0-9-]+)\)$/u.exec(value)?.[1];
  return reference === undefined ? parseColor(value) : resolveColor(reference);
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

function opaqueToken(name: string): Color {
  const color = resolveColor(name);
  return color.alpha === 1 ? color : composite(color, resolveColor("surface-canvas"));
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
  "surface-canvas",
  "surface-default",
  "surface-strong",
  "surface-subtle",
  "surface-tint",
  "surface-danger",
] as const;

describe("Web semantic color accessibility", () => {
  it("keeps normal text tokens at WCAG AA contrast on every light surface", () => {
    for (const foreground of [
      "text-primary",
      "text-secondary",
      "text-tertiary",
      "text-danger",
      "action-primary",
      "action-hover",
    ] as const) {
      for (const background of lightSurfaces) {
        expect(
          contrast(opaqueToken(foreground), opaqueToken(background)),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(
      contrast(opaqueToken("surface-strong"), opaqueToken("action-primary")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring distinguishable from every light surface", () => {
    for (const background of lightSurfaces) {
      expect(
        contrast(opaqueToken("focus-ring"), opaqueToken(background)),
        `focus-ring on ${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
