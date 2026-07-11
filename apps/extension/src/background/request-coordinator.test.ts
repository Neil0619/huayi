import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest, HostEvent, HostRequest } from "@huayi/protocol";

import {
  RequestCoordinator,
  type NativeDisconnect,
  type NativeTransport,
} from "./request-coordinator.js";

class FakeTransport implements NativeTransport {
  readonly sent: HostRequest[] = [];
  private disconnectListener: ((disconnect: NativeDisconnect) => void) | null = null;
  private eventListener: ((event: HostEvent) => void) | null = null;

  onDisconnect(listener: (disconnect: NativeDisconnect) => void): () => void {
    this.disconnectListener = listener;
    return () => {
      this.disconnectListener = null;
    };
  }

  onEvent(listener: (event: HostEvent) => void): () => void {
    this.eventListener = listener;
    return () => {
      this.eventListener = null;
    };
  }

  send(request: HostRequest): void {
    this.sent.push(request);
  }

  emitEvent(event: HostEvent): void {
    this.eventListener?.(event);
  }

  emitDisconnect(disconnect: NativeDisconnect): void {
    this.disconnectListener?.(disconnect);
  }
}

function analyzeRequest(requestId: string): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId,
    schemaVersion: 1,
    selection: "investigation",
    selectionKind: "word",
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

function createHarness(timeoutMs = 65_000) {
  const transport = new FakeTransport();
  const delivered: { event: HostEvent; tabId: number }[] = [];
  let nextId = 0;
  const coordinator = new RequestCoordinator({
    createRequestId: () => `control-${(nextId += 1)}`,
    sendToTab: (tabId, event) => {
      delivered.push({ event, tabId });
    },
    timeoutMs,
    transport,
  });
  return { coordinator, delivered, transport };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RequestCoordinator", () => {
  it("routes progress and results back to the originating tab", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("request-1"));
    transport.emitEvent({
      requestId: "request-1",
      schemaVersion: 1,
      stage: "running",
      type: "progress",
    });
    transport.emitEvent({
      requestId: "request-1",
      result: {
        selectionKind: "sentence",
        sourceText: "It is ready.",
        translationZh: "它已准备就绪。",
        type: "translate-passage",
      },
      schemaVersion: 1,
      type: "result",
    });

    expect(transport.sent).toEqual([analyzeRequest("request-1")]);
    expect(delivered.map(({ event, tabId }) => [tabId, event.type])).toEqual([
      [7, "progress"],
      [7, "result"],
    ]);
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });

  it("cancels the old request before starting a new request in the same tab", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("request-1"));
    coordinator.start(7, analyzeRequest("request-2"));

    expect(transport.sent).toEqual([
      analyzeRequest("request-1"),
      {
        requestId: "control-1",
        schemaVersion: 1,
        targetRequestId: "request-1",
        type: "cancel",
      },
      analyzeRequest("request-2"),
    ]);

    transport.emitEvent({
      requestId: "request-1",
      result: {
        selectionKind: "sentence",
        sourceText: "Late.",
        translationZh: "迟到的结果。",
        type: "translate-passage",
      },
      schemaVersion: 1,
      type: "result",
    });
    expect(delivered).toEqual([]);
    coordinator.dispose();
  });

  it("times out and cancels an unresponsive native request", () => {
    vi.useFakeTimers();
    const { coordinator, delivered, transport } = createHarness(1_000);
    coordinator.start(7, analyzeRequest("request-1"));

    vi.advanceTimersByTime(1_000);

    expect(delivered[0]?.event).toMatchObject({
      error: { code: "TIMEOUT", retryable: true },
      requestId: "request-1",
      type: "error",
    });
    expect(transport.sent[1]).toMatchObject({
      targetRequestId: "request-1",
      type: "cancel",
    });
    coordinator.dispose();
  });

  it("fails pending work when the host disconnects", () => {
    const { coordinator, delivered, transport } = createHarness();
    coordinator.start(7, analyzeRequest("request-1"));
    transport.emitDisconnect({ message: "Host not found.", reason: "host-unavailable" });

    expect(delivered[0]?.event).toMatchObject({
      error: { code: "HOST_NOT_INSTALLED", retryable: true },
      type: "error",
    });
    expect(coordinator.pendingCount).toBe(0);
    coordinator.dispose();
  });
});
