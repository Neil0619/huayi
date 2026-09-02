import { describe, expect, it } from "vitest";

import { DEFAULT_STORE_APPEARANCE, STORE_APPEARANCES, parseStoreAppearance } from "./appearance.js";

describe("Store appearance", () => {
  it("keeps the four approved production values stable with silver as the default", () => {
    expect(STORE_APPEARANCES).toEqual(["moon", "silver", "champagne", "porcelain"]);
    expect(DEFAULT_STORE_APPEARANCE).toBe("silver");
  });

  it.each(STORE_APPEARANCES)("parses %s", (appearance) => {
    expect(parseStoreAppearance(appearance)).toBe(appearance);
  });

  it.each([undefined, null, "", "C", "graphite", "silver ", 1, {}, []])(
    "rejects an invalid appearance value: %j",
    (value) => {
      expect(() => parseStoreAppearance(value)).toThrow("Store appearance is invalid.");
    },
  );
});
