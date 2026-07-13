import {
  SCHEMA_VERSION,
  hostEventSchema,
  hostWorkRequestSchema,
  warmupRequestSchema,
} from "@huayi/protocol";
import type { AnalysisError, HostEvent, HostWorkRequest, WarmupRequest } from "@huayi/protocol";

import type {
  NativeDisconnect,
  NativeDisconnectReason,
  NativeTransport,
} from "./native-transport.js";

export type { NativeDisconnect, NativeTransport } from "./native-transport.js";

interface PendingRequest {
  nextSequence: number;
  request: HostWorkRequest;
  tabId: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

type RequestLane = "analysis" | "wordbook-add" | "wordbook-check";
type WarmupState =
  { status: "idle" } | { requestId: string; status: "pending" } | { status: "ready" };

export interface RequestCoordinatorOptions {
  createRequestId?: () => string;
  sendToTab: (tabId: number, event: HostEvent) => Promise<void> | void;
  timeoutMs?: number;
  transport: NativeTransport;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 65_000;

function laneFor(request: HostWorkRequest): RequestLane {
  switch (request.type) {
    case "analyze":
      return "analysis";
    case "add-word":
      return "wordbook-add";
    case "check-word":
      return "wordbook-check";
  }
}

function errorForDisconnect(
  reason: NativeDisconnectReason,
  request: HostWorkRequest,
): AnalysisError {
  const isEudicRequest = request.type === "add-word" || request.type === "check-word";
  if (isEudicRequest && reason !== "invalid-message") {
    return {
      code: "HOST_NOT_INSTALLED",
      message: "本机服务未安装或版本过旧，请重新安装。",
      retryable: true,
    };
  }
  switch (reason) {
    case "host-unavailable":
      return {
        code: "HOST_NOT_INSTALLED",
        message: "未找到划译本机服务，请先完成安装。",
        retryable: true,
      };
    case "invalid-message":
      return {
        code: "INVALID_RESPONSE",
        message: "本机服务返回了无效数据。",
        retryable: false,
      };
    case "disconnected":
      return {
        code: "INTERNAL_ERROR",
        message: "本机服务连接已断开，请重试。",
        retryable: true,
      };
  }
}

export class RequestCoordinator {
  private readonly activeByTab = new Map<number, Map<RequestLane, string>>();
  private readonly createRequestId: () => string;
  private readonly pendingByRequestId = new Map<string, PendingRequest>();
  private readonly removeDisconnectListener: () => void;
  private readonly removeEventListener: () => void;
  private readonly sendToTab: RequestCoordinatorOptions["sendToTab"];
  private readonly timeoutMs: number;
  private readonly transport: NativeTransport;
  private warmupState: WarmupState = { status: "idle" };

  constructor(options: RequestCoordinatorOptions) {
    this.transport = options.transport;
    this.sendToTab = options.sendToTab;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.removeEventListener = this.transport.onEvent((event) => this.handleEvent(event));
    this.removeDisconnectListener = this.transport.onDisconnect((disconnect) =>
      this.handleDisconnect(disconnect),
    );
  }

  get pendingCount(): number {
    return this.pendingByRequestId.size;
  }

  warmup(): void {
    if (this.warmupState.status !== "idle") {
      return;
    }

    const request: WarmupRequest = warmupRequestSchema.parse({
      requestId: this.createRequestId(),
      schemaVersion: SCHEMA_VERSION,
      type: "warmup",
    });
    this.warmupState = { requestId: request.requestId, status: "pending" };
    try {
      this.transport.send(request);
    } catch {
      this.warmupState = { status: "idle" };
    }
  }

  start(tabId: number, request: HostWorkRequest): void {
    const validatedRequest = hostWorkRequestSchema.parse(request);
    const lane = laneFor(validatedRequest);
    switch (lane) {
      case "analysis":
        this.cancelAll(tabId);
        break;
      case "wordbook-check":
        this.cancelLane(tabId, lane);
        break;
      case "wordbook-add":
        this.cancelLane(tabId, "wordbook-check");
        this.cancelLane(tabId, lane);
        break;
    }

    const timeoutId = setTimeout(
      () => this.handleTimeout(validatedRequest.requestId),
      this.timeoutMs,
    );
    const pending = { nextSequence: 0, request: validatedRequest, tabId, timeoutId };
    this.pendingByRequestId.set(validatedRequest.requestId, pending);
    const activeByLane = this.activeByTab.get(tabId) ?? new Map<RequestLane, string>();
    activeByLane.set(lane, validatedRequest.requestId);
    this.activeByTab.set(tabId, activeByLane);

    try {
      this.transport.send(validatedRequest);
    } catch {
      this.finish(pending);
      this.deliverError(pending, {
        code: "HOST_NOT_INSTALLED",
        message: "无法连接划译本机服务，请确认已经安装。",
        retryable: true,
      });
    }
  }

  cancel(tabId: number, expectedRequestId: string): boolean {
    const activeByLane = this.activeByTab.get(tabId);
    if (activeByLane === undefined) {
      return false;
    }

    for (const [lane, requestId] of activeByLane) {
      if (requestId === expectedRequestId) {
        return this.cancelLane(tabId, lane);
      }
    }
    return false;
  }

  cancelTab(tabId: number): void {
    this.cancelAll(tabId);
  }

  dispose(): void {
    this.removeEventListener();
    this.removeDisconnectListener();
    for (const pending of this.pendingByRequestId.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingByRequestId.clear();
    this.activeByTab.clear();
    this.warmupState = { status: "idle" };
  }

  private handleEvent(event: HostEvent): void {
    if (this.warmupState.status === "pending" && event.requestId === this.warmupState.requestId) {
      this.handleWarmupEvent(event);
      return;
    }

    const pending = this.pendingByRequestId.get(event.requestId);
    if (pending === undefined) {
      return;
    }

    if (event.type === "progress") {
      this.deliver(pending.tabId, event);
      return;
    }

    if (event.type === "error") {
      this.finish(pending);
      this.deliver(pending.tabId, event);
      return;
    }

    const isAnalysisUpdate = event.type === "analysis-delta" || event.type === "analysis-section";
    if (isAnalysisUpdate) {
      if (pending.request.type === "analyze" && event.sequence === pending.nextSequence) {
        pending.nextSequence += 1;
        this.deliver(pending.tabId, event);
        return;
      }

      this.sendCancel(pending);
      this.finish(pending);
      this.deliverInvalidResponse(pending);
      return;
    }

    const isExpectedResult =
      (pending.request.type === "analyze" && event.type === "result") ||
      (pending.request.type === "check-word" && event.type === "word-status") ||
      (pending.request.type === "add-word" && event.type === "word-added");
    if (isExpectedResult) {
      this.finish(pending);
      this.deliver(pending.tabId, event);
      return;
    }
    this.sendCancel(pending);
    this.finish(pending);
    this.deliverInvalidResponse(pending);
  }

  private handleDisconnect(disconnect: NativeDisconnect): void {
    this.warmupState = { status: "idle" };
    for (const pending of [...this.pendingByRequestId.values()]) {
      this.finish(pending);
      this.deliverError(pending, errorForDisconnect(disconnect.reason, pending.request));
    }
  }

  private handleWarmupEvent(event: HostEvent): void {
    if (event.type === "warmup-ready") {
      this.warmupState = { status: "ready" };
      return;
    }
    if (event.type !== "error") {
      this.sendCancelRequest(event.requestId);
    }
    this.warmupState = { status: "idle" };
  }

  private handleTimeout(requestId: string): void {
    const pending = this.pendingByRequestId.get(requestId);
    if (pending === undefined) {
      return;
    }

    this.sendCancel(pending);
    this.finish(pending);
    this.deliverError(pending, {
      code: "TIMEOUT",
      message: "处理超时，请重试。",
      retryable: true,
    });
  }

  private sendCancel(pending: PendingRequest): void {
    this.sendCancelRequest(pending.request.requestId);
  }

  private sendCancelRequest(targetRequestId: string): void {
    try {
      this.transport.send({
        requestId: this.createRequestId(),
        schemaVersion: SCHEMA_VERSION,
        targetRequestId,
        type: "cancel",
      });
    } catch {
      // The request is still removed locally when the native port is already gone.
    }
  }

  private cancelAll(tabId: number): void {
    const activeByLane = this.activeByTab.get(tabId);
    if (activeByLane === undefined) {
      return;
    }

    for (const lane of [...activeByLane.keys()]) {
      this.cancelLane(tabId, lane);
    }
  }

  private cancelLane(tabId: number, lane: RequestLane): boolean {
    const activeByLane = this.activeByTab.get(tabId);
    if (activeByLane === undefined) {
      return false;
    }

    const requestId = activeByLane.get(lane);
    if (requestId === undefined) {
      return false;
    }

    const pending = this.pendingByRequestId.get(requestId);
    if (pending === undefined) {
      activeByLane.delete(lane);
      if (activeByLane.size === 0) {
        this.activeByTab.delete(tabId);
      }
      return false;
    }

    this.sendCancel(pending);
    this.finish(pending);
    return true;
  }

  private finish(pending: PendingRequest): void {
    clearTimeout(pending.timeoutId);
    this.pendingByRequestId.delete(pending.request.requestId);
    const activeByLane = this.activeByTab.get(pending.tabId);
    const lane = laneFor(pending.request);
    if (activeByLane?.get(lane) === pending.request.requestId) {
      activeByLane.delete(lane);
      if (activeByLane.size === 0) {
        this.activeByTab.delete(pending.tabId);
      }
    }
  }

  private deliverInvalidResponse(pending: PendingRequest): void {
    this.deliverError(pending, {
      code: "INVALID_RESPONSE",
      message: "本机服务返回了与请求不匹配的数据。",
      retryable: false,
    });
  }

  private deliverError(pending: PendingRequest, error: AnalysisError): void {
    const event = hostEventSchema.parse({
      error,
      requestId: pending.request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "error",
    });
    this.deliver(pending.tabId, event);
  }

  private deliver(tabId: number, event: HostEvent): void {
    try {
      const delivery = this.sendToTab(tabId, event);
      if (delivery instanceof Promise) {
        void delivery.catch(() => undefined);
      }
    } catch {
      // The tab may have closed between selection and delivery.
    }
  }
}
