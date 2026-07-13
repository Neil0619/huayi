import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent, HostWorkRequest } from "@huayi/protocol";

import {
  addWordRequest,
  analysisDeltaEvent,
  analysisSectionEvent,
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
  it("keeps warmup outside tab lanes and never cancels it with a tab", () => {
    const { coordinator, transport } = createHarness();

    coordinator.warmup();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.cancelTab(7);

    expect(transport.sent[0]).toEqual({
      requestId: "control-1",
      schemaVersion: 2,
      type: "warmup",
    });
    expect(cancelTargets(transport)).toEqual(["analysis-1"]);
    coordinator.dispose();
  });

  it("runs analysis and wordbook checks concurrently in one tab", () => {
    const { coordinator, delivered, transport } = createHarness();

    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    expect(transport.sent).toEqual([analyzeRequest("analysis-1"), checkWordRequest("check-1")]);
    expect(cancelTargets(transport)).toEqual([]);
    expect(coordinator.pendingCount).toBe(2);

    transport.emitEvent({
      requestId: "analysis-1",
      schemaVersion: 2,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent({
      requestId: "check-1",
      schemaVersion: 2,
      stage: "queued",
      type: "progress",
    });
    transport.emitEvent({
      presence: "absent",
      requestId: "check-1",
      schemaVersion: 2,
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
      schemaVersion: 2,
      type: "word-status",
    });

    expect(cancelTargets(transport)).toEqual(["check-1"]);
    expect(delivered).toEqual([]);
    expect(coordinator.pendingCount).toBe(2);
    coordinator.dispose();
  });
});

describe("RequestCoordinator events", () => {
  it("forwards mixed exact analysis updates without finishing analysis", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));

    transport.emitEvent({
      requestId: "analysis-1",
      schemaVersion: 2,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent(analysisDeltaEvent("analysis-1", 0));
    transport.emitEvent(analysisSectionEvent("analysis-1", 1));
    transport.emitEvent(analysisDeltaEvent("analysis-1", 2));

    expect(delivered.map(({ event }) => event.type)).toEqual([
      "progress",
      "analysis-delta",
      "analysis-section",
      "analysis-delta",
    ]);
    expect(coordinator.pendingCount).toBe(1);

    transport.emitEvent(resultEvent("analysis-1"));
    expect(delivered.at(-1)?.event.type).toBe("result");
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it.each([
    ["duplicate", [analysisDeltaEvent("analysis-1", 0), analysisSectionEvent("analysis-1", 0)]],
    ["skipped", [analysisSectionEvent("analysis-1", 1)]],
    [
      "decreasing",
      [
        analysisSectionEvent("analysis-1", 0),
        analysisDeltaEvent("analysis-1", 1),
        analysisSectionEvent("analysis-1", 0),
      ],
    ],
  ])("fails a %s mixed analysis sequence and targets only that request", (_name, events) => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    coordinator.start(7, checkWordRequest("check-1"));

    for (const event of events) {
      transport.emitEvent(event);
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

  it.each([
    [
      "analysis-delta for check-word",
      checkWordRequest("check-1"),
      analysisDeltaEvent("check-1", 0),
    ],
    [
      "analysis-section for check-word",
      checkWordRequest("check-1"),
      analysisSectionEvent("check-1", 0),
    ],
    ["analysis-delta for add-word", addWordRequest("add-1"), analysisDeltaEvent("add-1", 0)],
    ["analysis-section for add-word", addWordRequest("add-1"), analysisSectionEvent("add-1", 0)],
  ] as const)("rejects %s", (_name, request, update) => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, request);

    transport.emitEvent(update);

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.event).toMatchObject({
      error: { code: "INVALID_RESPONSE" },
      requestId: request.requestId,
      type: "error",
    });
    expect(cancelTargets(transport)).toEqual([request.requestId]);
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it("targets a wrong success terminal once and ignores later events", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));

    transport.emitEvent({
      presence: "present",
      requestId: "analysis-1",
      schemaVersion: 2,
      type: "word-status",
    });
    transport.emitEvent(analysisSectionEvent("analysis-1", 0));

    expect(cancelTargets(transport)).toEqual(["analysis-1"]);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.event).toMatchObject({
      error: { code: "INVALID_RESPONSE" },
      requestId: "analysis-1",
      type: "error",
    });
    coordinator.dispose();
  });

  it("finishes on the expected terminal and ignores late analysis updates locally", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("analysis-1"));
    transport.emitEvent(resultEvent("analysis-1"));

    transport.emitEvent(analysisDeltaEvent("analysis-1", 0));
    transport.emitEvent(analysisSectionEvent("analysis-1", 1));

    expect(delivered.map(({ event }) => event.type)).toEqual(["result"]);
    expect(cancelTargets(transport)).toEqual([]);
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it("accepts word-added only for add-word requests", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, addWordRequest("add-1"));

    transport.emitEvent({
      requestId: "add-1",
      schemaVersion: 2,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent({
      outcome: "added",
      requestId: "add-1",
      schemaVersion: 2,
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
          schemaVersion: 2,
          type: "word-status",
        },
        request: analyzeRequest("analysis-1"),
      },
      {
        event: {
          outcome: "already-exists",
          requestId: "check-1",
          schemaVersion: 2,
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
      expect(cancelTargets(transport)).toEqual([request.requestId]);
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
      schemaVersion: 2,
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
