import { describe, expect, it } from "vitest";

import { OverlayStateMachine } from "./overlay-state.js";

const session = {
  anchorRect: {
    bottom: 120,
    height: 20,
    left: 80,
    right: 180,
    top: 100,
    width: 100,
  },
  selection: {
    context: "The investigation was in its early stages.",
    selection: "investigation",
    selectionKind: "word",
  },
} as const;

describe("OverlayStateMachine", () => {
  it("follows actions to loading to result to closed", () => {
    const machine = new OverlayStateMachine();

    expect(machine.state.status).toBe("idle");
    machine.dispatch({ ...session, type: "SHOW_ACTIONS" });
    expect(machine.state.status).toBe("actions");
    machine.dispatch({ action: "translate", startedAt: 1_000, type: "START" });
    expect(machine.state.status).toBe("loading");
    machine.dispatch({
      result: {
        selectionKind: "sentence",
        sourceText: "It is ready.",
        translationZh: "它已准备就绪。",
        type: "translate-passage",
      },
      type: "RESOLVE",
    });
    expect(machine.state.status).toBe("result");
    machine.dispatch({ type: "CLOSE" });
    expect(machine.state.status).toBe("closed");
  });

  it("retries an error with the same action and ignores late results after close", () => {
    const machine = new OverlayStateMachine();
    machine.dispatch({ ...session, type: "SHOW_ACTIONS" });
    machine.dispatch({ action: "explain", startedAt: 1_000, type: "START" });
    machine.dispatch({
      error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
      type: "REJECT",
    });
    machine.dispatch({ startedAt: 2_000, type: "RETRY" });

    expect(machine.state).toMatchObject({ action: "explain", status: "loading" });

    machine.dispatch({ type: "CLOSE" });
    const closedState = machine.state;
    machine.dispatch({
      result: {
        selectionKind: "sentence",
        sourceText: "It is late.",
        translationZh: "它迟到了。",
        type: "translate-passage",
      },
      type: "RESOLVE",
    });
    expect(machine.state).toBe(closedState);
  });

  it("stores dragged positions only for visible states", () => {
    const machine = new OverlayStateMachine();
    machine.dispatch({ position: { left: 10, top: 20 }, type: "MOVE" });
    expect(machine.state).toEqual({ status: "idle" });

    machine.dispatch({ ...session, type: "SHOW_ACTIONS" });
    machine.dispatch({ position: { left: 10, top: 20 }, type: "MOVE" });
    expect(machine.state).toMatchObject({ position: { left: 10, top: 20 } });
  });
});
