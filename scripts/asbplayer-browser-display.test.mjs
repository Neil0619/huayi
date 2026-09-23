import assert from "node:assert/strict";
import { test } from "node:test";

import { asbplayerBrowserDisplay, verifyNativeDisplay } from "./asbplayer-browser-display.mjs";

test("default Store fixtures keep their existing viewport", () => {
  assert.equal(asbplayerBrowserDisplay({}, "win32"), undefined);
});

test("native Windows scale uses a headed browser without viewport or DPI emulation", () => {
  for (const scale of ["100", "150"]) {
    const display = asbplayerBrowserDisplay({ HUAYI_ASBPLAYER_NATIVE_SCALE: scale }, "win32");
    assert.deepEqual(display, {
      expectedScale: Number(scale) / 100,
      launchOptions: {
        headless: false,
        viewport: null,
        args: ["--window-size=1280,900", "--window-position=30,30"],
      },
    });
    assert.doesNotThrow(() => verifyNativeDisplay(display, { scale: Number(scale) / 100 }));
    assert.throws(() => verifyNativeDisplay(display, { scale: 2 }), /does not match/u);
  }
});

test("unsupported scales and non-Windows hosts cannot produce native Windows evidence", () => {
  for (const scale of ["", "125", "1.5", "150 --force-device-scale-factor=1.5"]) {
    assert.throws(
      () => asbplayerBrowserDisplay({ HUAYI_ASBPLAYER_NATIVE_SCALE: scale }, "win32"),
      /100 or 150/u,
    );
  }
  assert.throws(
    () => asbplayerBrowserDisplay({ HUAYI_ASBPLAYER_NATIVE_SCALE: "150" }, "darwin"),
    /requires Windows/u,
  );
});
