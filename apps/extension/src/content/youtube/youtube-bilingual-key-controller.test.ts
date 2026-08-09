import { afterEach, describe, expect, it, vi } from "vitest";

import { YouTubeBilingualKeyController } from "./youtube-bilingual-key-controller.js";

afterEach(() => {
  document.body.replaceChildren();
});

function f8(type: "keydown" | "keyup", repeat = false): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code: "F8",
    key: "F8",
    repeat,
  });
}

describe("YouTubeBilingualKeyController", () => {
  it("owns one claimed F8 press through repeats and keyup even if display state is cleared", () => {
    let holding = false;
    const setHolding = vi.fn((value: boolean) => {
      holding = value;
    });
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding,
    });
    const keydown = f8("keydown");
    controller.handleKeydown(keydown);
    expect(keydown.defaultPrevented).toBe(true);
    expect(holding).toBe(true);

    holding = false;
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const repeat = f8("keydown", true);
    controller.handleKeydown(repeat);
    expect(repeat.defaultPrevented).toBe(true);

    const keyup = f8("keyup");
    controller.handleKeyup(keyup);
    expect(keyup.defaultPrevented).toBe(true);
    expect(setHolding).toHaveBeenLastCalledWith(false);

    const lateRepeat = f8("keydown", true);
    controller.handleKeydown(lateRepeat);
    expect(lateRepeat.defaultPrevented).toBe(false);
  });

  it("does not claim a new F8 press while an editable control has focus", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding: vi.fn(),
    });
    const keydown = f8("keydown");

    controller.handleKeydown(keydown);

    expect(keydown.defaultPrevented).toBe(false);
  });

  it("leaves unmatched, repeated, and modified F8 events untouched", () => {
    const setHolding = vi.fn();
    const controller = new YouTubeBilingualKeyController(document, {
      canHold: () => true,
      setHolding,
    });
    const events = [
      f8("keydown", true),
      f8("keyup"),
      new KeyboardEvent("keydown", {
        cancelable: true,
        code: "F8",
        ctrlKey: true,
        key: "F8",
      }),
      new KeyboardEvent("keydown", {
        altKey: true,
        cancelable: true,
        code: "F8",
        key: "F8",
      }),
      new KeyboardEvent("keydown", {
        cancelable: true,
        code: "F8",
        key: "F8",
        metaKey: true,
      }),
      new KeyboardEvent("keydown", {
        cancelable: true,
        code: "F8",
        key: "F8",
        shiftKey: true,
      }),
    ];

    controller.handleKeydown(events[0] as KeyboardEvent);
    controller.handleKeyup(events[1] as KeyboardEvent);
    for (const event of events.slice(2)) controller.handleKeydown(event as KeyboardEvent);

    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
    expect(setHolding).not.toHaveBeenCalled();
  });
});
