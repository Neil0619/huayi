import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_APPEARANCE,
  WEB_APPEARANCES,
  WEB_APPEARANCE_STORAGE_KEY,
  initializeWebAppearance,
  readWebAppearance,
} from "./web-appearance.js";

describe("web appearance persistence", () => {
  it("defines only the four supported appearances and the versioned local key", () => {
    expect(WEB_APPEARANCES).toEqual(["moon", "silver", "champagne", "porcelain"]);
    expect(DEFAULT_WEB_APPEARANCE).toBe("silver");
    expect(WEB_APPEARANCE_STORAGE_KEY).toBe("huayi.web.appearance.v1");
  });

  it("reads a supported local value", () => {
    expect(readWebAppearance({ getItem: () => "champagne" })).toBe("champagne");
  });

  it.each([null, "", "dark", "SILVER"])("defaults an absent or invalid value %s", (value) => {
    expect(readWebAppearance({ getItem: () => value })).toBe("silver");
  });

  it("defaults when local storage cannot be read", () => {
    expect(
      readWebAppearance({
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
      }),
    ).toBe("silver");
  });

  it("writes the resolved appearance to html before React mounts", () => {
    const root = document.createElement("html");

    expect(
      initializeWebAppearance(root, {
        getItem: () => "porcelain",
      }),
    ).toBe("porcelain");
    expect(root.dataset.appearance).toBe("porcelain");
  });
});
