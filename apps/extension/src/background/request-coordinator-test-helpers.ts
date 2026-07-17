import type {
  AddWordRequest,
  AnalysisDeltaEvent,
  AnalysisSectionEvent,
  AnalyzeRequest,
  CheckWordRequest,
  HostEvent,
  HostRequest,
  ResultEvent,
} from "@huayi/protocol";

import {
  RequestCoordinator,
  type NativeDisconnect,
  type NativeTransport,
} from "./request-coordinator.js";

export class FakeTransport implements NativeTransport {
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

export function analyzeRequest(requestId: string): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId,
    schemaVersion: 5,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: null,
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

export function checkWordRequest(requestId: string): CheckWordRequest {
  return {
    language: "en",
    requestId,
    schemaVersion: 5,
    type: "check-word",
    word: "investigation",
  };
}

export function addWordRequest(requestId: string): AddWordRequest {
  return {
    context: "The investigation was in its early stages.",
    language: "en",
    requestId,
    schemaVersion: 5,
    type: "add-word",
    word: "investigation",
  };
}

export function analysisDeltaEvent(requestId: string, sequence: number): AnalysisDeltaEvent {
  return {
    delta: `delta-${sequence}`,
    requestId,
    schemaVersion: 5,
    section: "translation",
    sequence,
    type: "analysis-delta",
  };
}

export function analysisSectionEvent(requestId: string, sequence: number): AnalysisSectionEvent {
  return {
    requestId,
    schemaVersion: 5,
    section: "part-of-speech",
    sequence,
    type: "analysis-section",
    value: "noun",
  };
}

export function resultEvent(requestId: string): ResultEvent {
  return {
    requestId,
    result: {
      selectionKind: "sentence",
      sourceText: "It is ready.",
      translationZh: "它已准备就绪。",
      type: "translate-passage",
    },
    schemaVersion: 5,
    type: "result",
  };
}

export function createHarness(timeoutMs = 65_000) {
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

export function cancelTargets(transport: FakeTransport): string[] {
  return transport.sent.flatMap((request) =>
    request.type === "cancel" ? [request.targetRequestId] : [],
  );
}
