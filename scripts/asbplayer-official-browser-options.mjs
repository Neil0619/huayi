import { isAbsolute } from "node:path";

export function asbplayerOfficialBrowserOptions(arguments_, { supportsPopupWindow = false } = {}) {
  const options = { denyLocalFonts: false, commonPopupWindow: false };
  const seen = new Set();
  const fail = () => {
    throw new Error("Invalid approved official browser verification options.");
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (seen.has(flag)) fail();
    seen.add(flag);
    if (flag === "--run-approved-browser-validation") continue;
    if (flag === "--deny-local-fonts") options.denyLocalFonts = true;
    else if (flag === "--common-popup-window" && supportsPopupWindow)
      options.commonPopupWindow = true;
    else if (flag === "--browser-executable") {
      const path = arguments_[++index];
      if (
        typeof path !== "string" ||
        !isAbsolute(path) ||
        [...path].some((character) => character.charCodeAt(0) < 32)
      )
        fail();
      options.executablePath = path;
    } else fail();
  }
  if (!seen.has("--run-approved-browser-validation")) fail();
  return options;
}
