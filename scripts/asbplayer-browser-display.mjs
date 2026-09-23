import assert from "node:assert/strict";

// Test-only opt-in: measure the actual desktop, never force Chrome's device scale.
export function asbplayerBrowserDisplay(environment = process.env, platform = process.platform) {
  const value = environment.HUAYI_ASBPLAYER_NATIVE_SCALE;
  if (value === undefined) return undefined;
  assert.equal(platform, "win32", "Native Windows display verification requires Windows.");
  assert.ok(value === "100" || value === "150", "Expected native scale 100 or 150.");
  return {
    expectedScale: Number(value) / 100,
    launchOptions: {
      headless: false,
      viewport: null,
      args: ["--window-size=1280,900", "--window-position=30,30"],
    },
  };
}

export function verifyNativeDisplay(display, metrics) {
  assert.equal(metrics.scale, display.expectedScale, "Browser DPI does not match the OS scale.");
}
