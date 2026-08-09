import { afterEach, describe, expect, it, vi } from "vitest";

import { YouTubeBilingualKeyController } from "./youtube-bilingual-key-controller.js";

afterEach(() => {
  document.body.replaceChildren();
});

function shiftZ(type: "keydown" | "keyup", repeat = false): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code: "KeyZ",
    key: "Z",
    repeat,
    shiftKey: true,
  });
}

describe("YouTubeBilingualKeyController", () => {
  it("owns one claimed Shift+Z press through repeats and keyup", () => {
    const setHolding = vi.fn();
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding,
    });

    const keydown = shiftZ("keydown");
    const repeat = shiftZ("keydown", true);
    const keyup = new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      code: "KeyZ",
      key: "z",
      shiftKey: false,
    });
    controller.handleKeydown(keydown);
    controller.handleKeydown(repeat);
    controller.handleKeyup(keyup);

    expect(keydown.defaultPrevented).toBe(true);
    expect(repeat.defaultPrevented).toBe(true);
    expect(keyup.defaultPrevented).toBe(true);
    expect(setHolding).toHaveBeenNthCalledWith(1, true);
    expect(setHolding).toHaveBeenNthCalledWith(2, false);
  });

  it("does not claim lowercase Z or Caps Lock Z without Shift", () => {
    const setHolding = vi.fn();
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding,
    });
    const lowercase = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyZ",
      key: "z",
    });
    const capsLock = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyZ",
      key: "Z",
    });

    controller.handleKeydown(lowercase);
    controller.handleKeydown(capsLock);

    expect(lowercase.defaultPrevented).toBe(false);
    expect(capsLock.defaultPrevented).toBe(false);
    expect(setHolding).not.toHaveBeenCalled();
  });

  it("does not claim Shift+Z while an editable control has focus", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding: vi.fn(),
    });
    const keydown = shiftZ("keydown");

    controller.handleKeydown(keydown);

    expect(keydown.defaultPrevented).toBe(false);
  });

  it("leaves repeated and modified Shift+Z events untouched before the press is claimed", () => {
    const setHolding = vi.fn();
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding,
    });
    const repeat = shiftZ("keydown", true);
    const ctrl = new KeyboardEvent("keydown", {
      cancelable: true,
      code: "KeyZ",
      ctrlKey: true,
      key: "Z",
      shiftKey: true,
    });

    controller.handleKeydown(repeat);
    controller.handleKeydown(ctrl);

    expect(repeat.defaultPrevented).toBe(false);
    expect(ctrl.defaultPrevented).toBe(false);
    expect(setHolding).not.toHaveBeenCalled();
  });
});
