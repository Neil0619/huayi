import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent, HostWorkRequest } from "@huayi/protocol";

import {
  addWordRequest,
  analysisDeltaEvent,
  analyzeRequest,
  cancelTargets,
  checkWordRequest,
  createHarness,
  resultEvent,
} from "./request-coordinator-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("RequestCoordinator lanes", () => {
  it("runs analysis and wordbook checks concurrently in one tab", () => {
    const { coordinator, delivered, transport } = createHarness();

    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    expect(transport.sent).toEqual([analyzeRequest("analysis-1"), checkWordRequest("check-1")]);
    expect(cancelTargets(transport)).toEqual([]);
    expect(coordinator.pendingCount).toBe(2);

    transport.emitEvent({
      requestId: "analysis-1",
      schemaVersion: 1,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent({
      requestId: "check-1",
      schemaVersion: 1,
      stage: "queued",
      type: "progress",
    });
    transport.emitEvent({
      presence: "absent",
      requestId: "check-1",
      schemaVersion: 1,
      type: "word-status",
    });
    transport.emitEvent(resultEvent("analysis-1"));

    expect(delivered.map(({ event }) => event.type)).toEqual([
      "progress",
      "progress",
      "word-status",
      "result",
    ]);
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it("cancels every prior lane before starting a new analysis", () => {
    const { coordinator, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, addWordRequest("add-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    coordinator.start(7, analyzeRequest("analysis-2"));

    expect(cancelTargets(transport).sort()).toEqual(["add-1", "analysis-1", "check-1"]);
    expect(transport.sent.at(-1)).toEqual(analyzeRequest("analysis-2"));
    expect(coordinator.pendingCount).toBe(1);
    coordinator.dispose();
  });

  it("replaces only the prior wordbook check", () => {
    const { coordinator, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, addWordRequest("add-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    coordinator.start(7, checkWordRequest("check-2"));

    expect(cancelTargets(transport)).toEqual(["check-1"]);
    expect(transport.sent.at(-1)).toEqual(checkWordRequest("check-2"));
    expect(coordinator.pendingCount).toBe(3);
    coordinator.dispose();
  });

  it("cancels the check lane and replaces only the prior add lane", () => {
    const { coordinator, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, addWordRequest("add-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    coordinator.start(7, addWordRequest("add-2"));

    expect(cancelTargets(transport)).toEqual(["check-1", "add-1"]);
    expect(transport.sent.at(-1)).toEqual(addWordRequest("add-2"));
    expect(coordinator.pendingCount).toBe(2);
    coordinator.dispose();
  });

  it("keeps targeted cancellation exact and ignores the cancelled request's late events", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, addWordRequest("add-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    expect(coordinator.cancel(7, "missing")).toBe(false);
    expect(coordinator.cancel(7, "check-1")).toBe(true);
    transport.emitEvent({
      presence: "present",
      requestId: "check-1",
      schemaVersion: 1,
      type: "word-status",
    });

    expect(cancelTargets(transport)).toEqual(["check-1"]);
    expect(delivered).toEqual([]);
    expect(coordinator.pendingCount).toBe(2);
    coordinator.dispose();
  });
});

describe("RequestCoordinator events", () => {
  it("forwards progress and exact analysis deltas without finishing analysis", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));

    transport.emitEvent({
      requestId: "analysis-1",
      schemaVersion: 1,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent(analysisDeltaEvent("analysis-1", 0));
    transport.emitEvent(analysisDeltaEvent("analysis-1", 1));

    expect(delivered.map(({ event }) => event.type)).toEqual([
      "progress",
      "analysis-delta",
      "analysis-delta",
    ]);
    expect(coordinator.pendingCount).toBe(1);

    transport.emitEvent(resultEvent("analysis-1"));
    expect(delivered.at(-1)?.event.type).toBe("result");
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it.each([
    ["duplicate", [0, 0]],
    ["skipped", [1]],
    ["decreasing", [0, 1, 0]],
  ])("fails a %s analysis delta sequence and targets only that request", (_name, sequences) => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    for (const sequence of sequences) {
      transport.emitEvent(analysisDeltaEvent("analysis-1", sequence));
    }

    expect(delivered.at(-1)?.event).toMatchObject({
      error: { code: "INVALID_RESPONSE" },
      requestId: "analysis-1",
      type: "error",
    });
    expect(cancelTargets(transport)).toEqual(["analysis-1"]);
    expect(coordinator.pendingCount).toBe(1);
    coordinator.dispose();
  });

  it.each([checkWordRequest("check-1"), addWordRequest("add-1")])(
    "rejects analysis deltas for $type requests",
    (request) => {
      const { coordinator, delivered, transport } = createHarness();
      coordinator.start(7, request);

      transport.emitEvent(analysisDeltaEvent(request.requestId, 0));

      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.event).toMatchObject({
        error: { code: "INVALID_RESPONSE" },
        requestId: request.requestId,
        type: "error",
      });
      expect(cancelTargets(transport)).toEqual([request.requestId]);
      expect(coordinator.pendingCount).toBe(0);
      coordinator.dispose();
    },
  );

  it("accepts word-added only for add-word requests", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, addWordRequest("add-1"));

    transport.emitEvent({
      requestId: "add-1",
      schemaVersion: 1,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent({
      outcome: "added",
      requestId: "add-1",
      schemaVersion: 1,
      type: "word-added",
    });

    expect(delivered.map(({ event }) => event.type)).toEqual(["progress", "word-added"]);
    expect(delivered.at(-1)?.event).toMatchObject({ outcome: "added", type: "word-added" });
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it("fails closed when a success terminal does not match its request type", () => {
    const cases: { event: HostEvent; request: HostWorkRequest }[] = [
      {
        event: {
          presence: "present",
          requestId: "analysis-1",
          schemaVersion: 1,
          type: "word-status",
        },
        request: analyzeRequest("analysis-1"),
      },
      {
        event: {
          outcome: "already-exists",
          requestId: "check-1",
          schemaVersion: 1,
          type: "word-added",
        },
        request: checkWordRequest("check-1"),
      },
      { event: resultEvent("add-1"), request: addWordRequest("add-1") },
    ];

    for (const { event, request } of cases) {
      const { coordinator, delivered, transport } = createHarness();
      coordinator.start(7, request);
      transport.emitEvent(event);

      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.event).toMatchObject({
        error: { code: "INVALID_RESPONSE" },
        requestId: request.requestId,
        type: "error",
      });
      expect(coordinator.pendingCount).toBe(0);
      coordinator.dispose();
    }
  });
});

describe("RequestCoordinator failures", () => {
  it("times out every concurrent request once and ignores late events", () => {
    vi.useFakeTimers();
    const { coordinator, delivered, transport } = createHarness(1_000);
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, addWordRequest("add-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    vi.advanceTimersByTime(1_000);

    expect(delivered).toHaveLength(3);
    expect(delivered.every(({ event }) => event.type === "error")).toBe(true);
    expect(delivered.map(({ event }) => event.requestId).sort()).toEqual([
      "add-1",
      "analysis-1",
      "check-1",
    ]);
    expect(cancelTargets(transport).sort()).toEqual(["add-1", "analysis-1", "check-1"]);
    expect(coordinator.pendingCount).toBe(0);

    vi.advanceTimersByTime(1_000);
    transport.emitEvent(resultEvent("analysis-1"));
    transport.emitEvent({
      presence: "absent",
      requestId: "check-1",
      schemaVersion: 1,
      type: "word-status",
    });
    expect(delivered).toHaveLength(3);
    coordinator.dispose();
  });

  it("settles concurrent requests once and explains old hosts for both Eudic request types", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, addWordRequest("add-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    transport.emitDisconnect({ message: "Host exited.", reason: "disconnected" });

    expect(delivered).toHaveLength(3);
    for (const requestId of ["add-1", "check-1"]) {
      expect(delivered.find(({ event }) => event.requestId === requestId)?.event).toMatchObject({
        error: {
          code: "HOST_NOT_INSTALLED",
          message: expect.stringContaining("版本过旧"),
        },
        type: "error",
      });
    }
    expect(coordinator.pendingCount).toBe(0);

    transport.emitDisconnect({ message: "Host exited again.", reason: "disconnected" });
    transport.emitEvent(resultEvent("analysis-1"));
    expect(delivered).toHaveLength(3);
    coordinator.dispose();
  });
});
