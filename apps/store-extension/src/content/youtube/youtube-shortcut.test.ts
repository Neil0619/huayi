import { describe, expect, it, vi } from "vitest";

import { YouTubeShortcutController } from "./youtube-shortcut.js";

describe("Store YouTube migrated shortcut", () => {
  it("holds bilingual text only for the exact configured chord", () => {
    const setHolding = vi.fn();
    const controller = new YouTubeShortcutController(document, {
      canHold: () => true,
      setHolding,
      shortcut: { alt: false, code: "KeyK", ctrl: true, meta: false, shift: false },
    });
    const wrong = new KeyboardEvent("keydown", {
      bubbles: true,
      code: "KeyK",
      shiftKey: true,
    });
    controller.handleKeydown(wrong);
    expect(setHolding).not.toHaveBeenCalled();

    const down = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyK",
      ctrlKey: true,
    });
    controller.handleKeydown(down);
    expect(down.defaultPrevented).toBe(true);
    expect(setHolding).toHaveBeenLastCalledWith(true);

    const up = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, code: "KeyK" });
    controller.handleKeyup(up);
    expect(up.defaultPrevented).toBe(true);
    expect(setHolding).toHaveBeenLastCalledWith(false);
  });

  it("stays inert when disabled or while an editable field has focus", () => {
    const setHolding = vi.fn();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const controller = new YouTubeShortcutController(document, {
      canHold: () => true,
      setHolding,
      shortcut: { alt: false, code: "KeyK", ctrl: true, meta: false, shift: false },
    });
    controller.handleKeydown(new KeyboardEvent("keydown", { code: "KeyK", ctrlKey: true }));
    expect(setHolding).not.toHaveBeenCalled();

    input.remove();
    const disabled = new YouTubeShortcutController(document, {
      canHold: () => true,
      setHolding,
      shortcut: null,
    });
    disabled.handleKeydown(new KeyboardEvent("keydown", { code: "KeyK", ctrlKey: true }));
    expect(setHolding).not.toHaveBeenCalled();
  });
});
