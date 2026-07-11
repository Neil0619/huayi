import { SCHEMA_VERSION, hostEventSchema, hostWorkRequestSchema } from "@huayi/protocol";
import type { AnalysisError, HostEvent, HostWorkRequest } from "@huayi/protocol";

import type {
  NativeDisconnect,
  NativeDisconnectReason,
  NativeTransport,
} from "./native-transport.js";

export type { NativeDisconnect, NativeTransport } from "./native-transport.js";

interface PendingRequest {
  request: HostWorkRequest;
  tabId: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface RequestCoordinatorOptions {
  createRequestId?: () => string;
  sendToTab: (tabId: number, event: HostEvent) => Promise<void> | void;
  timeoutMs?: number;
  transport: NativeTransport;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 65_000;

function errorForDisconnect(
  reason: NativeDisconnectReason,
  request: HostWorkRequest,
): AnalysisError {
  if (request.type === "add-word" && reason !== "invalid-message") {
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
  private readonly activeRequestByTab = new Map<number, string>();
  private readonly createRequestId: () => string;
  private readonly pendingByRequestId = new Map<string, PendingRequest>();
  private readonly removeDisconnectListener: () => void;
  private readonly removeEventListener: () => void;
  private readonly sendToTab: RequestCoordinatorOptions["sendToTab"];
  private readonly timeoutMs: number;
  private readonly transport: NativeTransport;

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

  start(tabId: number, request: HostWorkRequest): void {
    const validatedRequest = hostWorkRequestSchema.parse(request);
    this.cancel(tabId);

    const timeoutId = setTimeout(
      () => this.handleTimeout(validatedRequest.requestId),
      this.timeoutMs,
    );
    const pending = { request: validatedRequest, tabId, timeoutId };
    this.pendingByRequestId.set(validatedRequest.requestId, pending);
    this.activeRequestByTab.set(tabId, validatedRequest.requestId);

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

  cancel(tabId: number, expectedRequestId?: string): boolean {
    const requestId = this.activeRequestByTab.get(tabId);
    if (
      requestId === undefined ||
      (expectedRequestId !== undefined && requestId !== expectedRequestId)
    ) {
      return false;
    }

    const pending = this.pendingByRequestId.get(requestId);
    if (pending === undefined) {
      this.activeRequestByTab.delete(tabId);
      return false;
    }

    this.sendCancel(pending);
    this.finish(pending);
    return true;
  }

  dispose(): void {
    this.removeEventListener();
    this.removeDisconnectListener();
    for (const pending of this.pendingByRequestId.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingByRequestId.clear();
    this.activeRequestByTab.clear();
  }

  private handleEvent(event: HostEvent): void {
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

    const isExpectedResult =
      (pending.request.type === "analyze" && event.type === "result") ||
      (pending.request.type === "add-word" && event.type === "word-added");
    this.finish(pending);
    if (isExpectedResult) {
      this.deliver(pending.tabId, event);
      return;
    }
    this.deliverError(pending, {
      code: "INVALID_RESPONSE",
      message: "本机服务返回了与请求不匹配的数据。",
      retryable: false,
    });
  }

  private handleDisconnect(disconnect: NativeDisconnect): void {
    for (const pending of [...this.pendingByRequestId.values()]) {
      this.finish(pending);
      this.deliverError(pending, errorForDisconnect(disconnect.reason, pending.request));
    }
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
    try {
      this.transport.send({
        requestId: this.createRequestId(),
        schemaVersion: SCHEMA_VERSION,
        targetRequestId: pending.request.requestId,
        type: "cancel",
      });
    } catch {
      // The request is still removed locally when the native port is already gone.
    }
  }

  private finish(pending: PendingRequest): void {
    clearTimeout(pending.timeoutId);
    this.pendingByRequestId.delete(pending.request.requestId);
    if (this.activeRequestByTab.get(pending.tabId) === pending.request.requestId) {
      this.activeRequestByTab.delete(pending.tabId);
    }
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
