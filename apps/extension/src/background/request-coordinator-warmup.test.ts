import { describe, expect, it } from "vitest";

import { createHarness } from "./request-coordinator-test-helpers.js";

describe("RequestCoordinator warmup", () => {
  it("deduplicates pending and ready warmup, then resets after disconnect", () => {
    const { coordinator, delivered, transport } = createHarness();

    coordinator.warmup();
    coordinator.warmup();
    expect(transport.sent).toEqual([{ requestId: "control-1", schemaVersion: 5, type: "warmup" }]);

    transport.emitEvent({
      requestId: "control-1",
      schemaVersion: 5,
      type: "warmup-ready",
    });
    coordinator.warmup();
    expect(transport.sent).toHaveLength(1);
    expect(delivered).toEqual([]);

    transport.emitDisconnect({ reason: "disconnected" });
    coordinator.warmup();
    expect(transport.sent.at(-1)).toEqual({
      requestId: "control-2",
      schemaVersion: 5,
      type: "warmup",
    });
    expect(delivered).toEqual([]);
    coordinator.dispose();
  });

  it("resets failed warmup without delivering its error to a tab", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.warmup();
    transport.emitEvent({
      error: { code: "INTERNAL_ERROR", message: "Warmup failed.", retryable: true },
      requestId: "control-1",
      schemaVersion: 5,
      type: "error",
    });

    coordinator.warmup();

    expect(transport.sent).toEqual([
      { requestId: "control-1", schemaVersion: 5, type: "warmup" },
      { requestId: "control-2", schemaVersion: 5, type: "warmup" },
    ]);
    expect(delivered).toEqual([]);
    coordinator.dispose();
  });
});
