import { SCHEMA_VERSION } from "@huayi/protocol";
import type {
  AddWordRequest,
  AnalysisError,
  AnalyzeRequest,
  CheckWordRequest,
  HostEvent,
  HostRequest,
  WordbookAddOutcome,
} from "@huayi/protocol";

import { RequestCoordinator } from "../../src/background/request-coordinator.js";
import {
  createRuntimeMessageListener,
  type RuntimeMessageListener,
} from "../../src/background/service-worker.js";
import { initializeContentScript, type ContentRuntime } from "../../src/content/content-script.js";
import type { ContentCommand } from "../../src/shared/extension-messages.js";
import {
  createCollocationsEvent,
  createResultEvent,
  createSectionEvent,
} from "./harness-results.js";
import { MockNativeTransport } from "./mock-native-transport.js";

const TAB_ID = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 65_000;
const PENDING_SELECTION = "pending request";
const RETRY_SELECTION = "temporary failure";
const TIMEOUT_SELECTION = "timeout request";
const PENDING_WORDBOOK_WORD = "pendingword";
const PENDING_ANALYSIS_WORD = "holdingword";
const STALE_EVENT_WORD = "staleevent";

const wordPresence: Record<string, "present" | "absent" | "late-present" | "error"> = {
  established: "present",
  investigation: "absent",
  lateexisting: "late-present",
  unconfigured: "error",
};

const configuredRequestTimeoutMs = new URLSearchParams(window.location.search).get(
  "request-timeout-ms",
);
const requestTimeoutMs =
  configuredRequestTimeoutMs === null
    ? DEFAULT_REQUEST_TIMEOUT_MS
    : Number(configuredRequestTimeoutMs);
const configuredToolbarVisibilityDelayMs = new URLSearchParams(window.location.search).get(
  "toolbar-visibility-delay-ms",
);
const toolbarVisibilityDelayMs =
  configuredToolbarVisibilityDelayMs === null ? 0 : Number(configuredToolbarVisibilityDelayMs);

class MockExtensionRuntime implements ContentRuntime {
  private readonly contentListeners = new Set<(message: unknown) => void>();
  private backgroundListener: RuntimeMessageListener | null = null;

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void): void => {
      this.contentListeners.add(listener);
    },
    removeListener: (listener: (message: unknown) => void): void => {
      this.contentListeners.delete(listener);
    },
  };

  connectBackground(listener: RuntimeMessageListener): void {
    this.backgroundListener = listener;
  }

  sendMessage(message: ContentCommand): Promise<unknown> {
    let response: { handled: boolean } = { handled: false };
    this.backgroundListener?.(message, { tab: { id: TAB_ID } }, (nextResponse) => {
      response = nextResponse;
    });
    return Promise.resolve(response);
  }

  sendToContent(event: HostEvent): void {
    for (const listener of this.contentListeners) {
      listener(event);
    }
  }
}

function appendRequestLog(log: HTMLOListElement, request: HostRequest): void {
  const entry = document.createElement("li");
  entry.dataset.nativeRequest = request.type;
  entry.dataset.requestId = request.requestId;
  entry.dataset.requestKeys = Object.keys(request).sort().join(",");
  entry.dataset.schemaVersion = String(request.schemaVersion);

  if (request.type === "analyze") {
    entry.dataset.analysisAction = request.action;
    entry.dataset.selectionKind = request.selectionKind;
    entry.dataset.selectionText = request.selection;
    entry.dataset.sentenceContext = request.sentenceContext ?? "";
  } else if (request.type === "cancel") {
    entry.dataset.targetRequestId = request.targetRequestId;
  } else if (request.type === "add-word") {
    entry.dataset.word = request.word;
    entry.dataset.wordbookContext = request.context;
  } else if (request.type === "check-word") {
    entry.dataset.word = request.word;
  }

  log.append(entry);
}

function wordbookResponse(
  request: AddWordRequest,
  attempt: number,
): { error: AnalysisError } | { outcome: WordbookAddOutcome } | null {
  switch (request.word) {
    case PENDING_WORDBOOK_WORD:
      return null;
    case "established":
      return { outcome: "already-exists" };
    case "unconfigured":
      return attempt === 1
        ? {
            error: {
              code: "EUDIC_NOT_CONFIGURED",
              message: "尚未配置欧路授权，请先运行配置命令。",
              retryable: false,
            },
          }
        : { outcome: "added" };
    case "unauthorized":
      return attempt === 1
        ? {
            error: {
              code: "EUDIC_AUTH_FAILED",
              message: "欧路授权无效或已过期，请重新配置。",
              retryable: false,
            },
          }
        : { outcome: "added" };
    case "resilient":
      return attempt === 1
        ? {
            error: {
              code: "NETWORK_ERROR",
              message: "无法连接欧路服务，请检查网络后重试。",
              retryable: true,
            },
          }
        : { outcome: "added" };
    case "throttled":
      return {
        error: {
          code: "RATE_LIMITED",
          message: "欧路请求过于频繁，请稍后再试。",
          retryable: false,
        },
      };
    default:
      return { outcome: "added" };
  }
}

function createDeltaEvent(request: AnalyzeRequest, sequence: number, delta: string): HostEvent {
  const section =
    request.selectionKind === "word" || request.selectionKind === "phrase"
      ? "contextual-meaning"
      : request.action === "explain" && sequence === 0
        ? "main-structure"
        : "translation";
  return {
    delta,
    requestId: request.requestId,
    schemaVersion: SCHEMA_VERSION,
    section,
    sequence,
    type: "analysis-delta",
  };
}

function emitWordStatus(request: CheckWordRequest, presence: "present" | "absent"): void {
  transport.emit({
    presence,
    requestId: request.requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-status",
  });
}

function handleWordCheck(request: CheckWordRequest): void {
  if (request.word === PENDING_ANALYSIS_WORD) {
    return;
  }
  if (request.word === STALE_EVENT_WORD) {
    setTimeout(() => emitWordStatus(request, "present"), 1_550);
    return;
  }

  const scenario = wordPresence[request.word] ?? "absent";
  if (scenario === "late-present") {
    setTimeout(() => emitWordStatus(request, "present"), 50);
    return;
  }
  queueMicrotask(() => {
    if (scenario === "error") {
      transport.emit({
        error: {
          code: "EUDIC_NOT_CONFIGURED",
          message: "尚未配置欧路授权，请先运行配置命令。",
          retryable: false,
        },
        requestId: request.requestId,
        schemaVersion: SCHEMA_VERSION,
        type: "error",
      });
      return;
    }
    emitWordStatus(request, scenario);
  });
}

function emitAnalyzeResponse(request: AnalyzeRequest): void {
  if (request.selection === PENDING_ANALYSIS_WORD) {
    return;
  }
  if (request.selection === STALE_EVENT_WORD) {
    queueMicrotask(() => transport.emit(createDeltaEvent(request, 0, "正在逐步显示")));
    setTimeout(() => transport.emit(createDeltaEvent(request, 1, "迟到文本")), 1_500);
    setTimeout(() => transport.emit(createResultEvent(request)), 1_600);
    return;
  }

  queueMicrotask(() => {
    transport.emit(createDeltaEvent(request, 0, "正在逐步"));
    queueMicrotask(() => {
      transport.emit(createDeltaEvent(request, 1, "显示"));
      const sectionEvent = createSectionEvent(request, 2);
      if (sectionEvent !== null) {
        transport.emit(sectionEvent);
      }
      if (request.selection === "investigation") {
        const firstCollocation = createCollocationsEvent(request, 3, 1);
        const secondCollocation = createCollocationsEvent(request, 4, 2);
        if (firstCollocation !== null && secondCollocation !== null) {
          setTimeout(() => transport.emit(firstCollocation), 50);
          setTimeout(() => transport.emit(secondCollocation), 250);
        }
      }
      if (request.selection === "lateexisting") {
        queueMicrotask(() => transport.emit(createResultEvent(request)));
      } else {
        setTimeout(() => transport.emit(createResultEvent(request)), 500);
      }
    });
  });
}

const requestLog = document.querySelector<HTMLOListElement>("[data-native-request-log]");
if (requestLog === null) {
  throw new Error("The E2E fixture must provide a native request log.");
}

function installDelayedToolbarVisibilityFixture(delayMs: number): void {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }
  const observer = new MutationObserver(() => {
    const host = document.querySelector<HTMLElement>("[data-huayi-overlay-host]");
    const toolbarElement = host?.shadowRoot?.querySelector<HTMLElement>(".huayi-toolbar");
    if (toolbarElement === null || toolbarElement === undefined) {
      return;
    }
    observer.disconnect();
    toolbarElement.style.visibility = "hidden";
    window.setTimeout(() => {
      toolbarElement.style.removeProperty("visibility");
    }, delayMs);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

installDelayedToolbarVisibilityFixture(toolbarVisibilityDelayMs);

const runtime = new MockExtensionRuntime();
const transport = new MockNativeTransport();
const attempts = new Map<string, number>();
let contentRequestSequence = 0;
let coordinatorRequestSequence = 0;

const coordinator = new RequestCoordinator({
  createRequestId: () => `e2e-coordinator-${(coordinatorRequestSequence += 1)}`,
  sendToTab: (tabId, event) => {
    if (tabId === TAB_ID) {
      runtime.sendToContent(event);
    }
  },
  timeoutMs: requestTimeoutMs,
  transport,
});
runtime.connectBackground(createRuntimeMessageListener(coordinator));

transport.onRequest((request) => {
  appendRequestLog(requestLog, request);
  if (request.type === "warmup") {
    queueMicrotask(() => {
      transport.emit({
        requestId: request.requestId,
        schemaVersion: SCHEMA_VERSION,
        type: "warmup-ready",
      });
    });
    return;
  }
  if (request.type === "check-word") {
    handleWordCheck(request);
    return;
  }
  if (request.type === "add-word") {
    const attemptKey = `add-word\u0000${request.word}`;
    const attempt = (attempts.get(attemptKey) ?? 0) + 1;
    attempts.set(attemptKey, attempt);
    const response = wordbookResponse(request, attempt);
    if (response === null) {
      return;
    }
    queueMicrotask(() => {
      transport.emit(
        "error" in response
          ? {
              error: response.error,
              requestId: request.requestId,
              schemaVersion: SCHEMA_VERSION,
              type: "error",
            }
          : {
              outcome: response.outcome,
              requestId: request.requestId,
              schemaVersion: SCHEMA_VERSION,
              type: "word-added",
            },
      );
    });
    return;
  }
  if (
    request.type !== "analyze" ||
    request.selection === PENDING_SELECTION ||
    request.selection === TIMEOUT_SELECTION
  ) {
    return;
  }

  const attemptKey = `${request.selection}\u0000${request.action}`;
  const attempt = (attempts.get(attemptKey) ?? 0) + 1;
  attempts.set(attemptKey, attempt);

  if (request.selection === RETRY_SELECTION && attempt === 1) {
    queueMicrotask(() => {
      transport.emit({
        error: {
          code: "NETWORK_ERROR",
          message: "模拟网络暂时不可用，请重试。",
          retryable: true,
        },
        requestId: request.requestId,
        schemaVersion: SCHEMA_VERSION,
        type: "error",
      });
    });
    return;
  }

  emitAnalyzeResponse(request);
});

initializeContentScript({
  createRequestId: () => `e2e-content-${(contentRequestSequence += 1)}`,
  runtime,
});
