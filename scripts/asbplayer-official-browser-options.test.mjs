import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { asbplayerOfficialBrowserOptions } from "./asbplayer-official-browser-options.mjs";

const approved = "--run-approved-browser-validation";

test("official browser defaults preserve the bundled browser and unmodified permission policy", () => {
  assert.deepEqual(asbplayerOfficialBrowserOptions([approved]), {
    denyLocalFonts: false,
    commonPopupWindow: false,
  });
});

test("explicit browser and permission options preserve a literal absolute executable path", () => {
  const executablePath = resolve("browser directory & fixture", "chrome.exe");
  assert.deepEqual(
    asbplayerOfficialBrowserOptions([
      approved,
      "--browser-executable",
      executablePath,
      "--deny-local-fonts",
    ]),
    { executablePath, denyLocalFonts: true, commonPopupWindow: false },
  );
});

test("real popup sizing is an explicit basic-script option", () => {
  assert.deepEqual(
    asbplayerOfficialBrowserOptions([approved, "--common-popup-window"], {
      supportsPopupWindow: true,
    }),
    { denyLocalFonts: false, commonPopupWindow: true },
  );
  assert.throws(() => asbplayerOfficialBrowserOptions([approved, "--common-popup-window"]));
});

test("official browser options fail closed on missing approval and ambiguous arguments", () => {
  for (const arguments_ of [
    [],
    [approved, approved],
    [approved, "--unknown"],
    [approved, "--browser-executable"],
    [approved, "--browser-executable", "relative/chrome.exe"],
    [approved, "--browser-executable", "--deny-local-fonts"],
    [approved, "--deny-local-fonts", "--deny-local-fonts"],
  ]) {
    assert.throws(() => asbplayerOfficialBrowserOptions(arguments_));
  }
});
