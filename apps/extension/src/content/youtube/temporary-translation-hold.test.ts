import { describe, expect, it, vi } from "vitest";

import { TemporaryTranslationHold } from "./temporary-translation-hold.js";

describe("TemporaryTranslationHold", () => {
  it("keeps translation visible until all input sources release", () => {
    const onChange = vi.fn();
    const hold = new TemporaryTranslationHold(onChange);
    hold.set("keyboard", true);
    hold.set("pointer", true);
    hold.set("keyboard", false);
    expect(hold.isHeld).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    hold.set("pointer", false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
