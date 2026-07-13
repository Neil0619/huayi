import {
  SCHEMA_VERSION,
  addWordRequestSchema,
  analyzeRequestSchema,
  checkWordRequestSchema,
  hostEventSchema,
} from "@huayi/protocol";
import type {
  AddWordRequest,
  AnalysisError,
  AnalyzeAction,
  AnalyzeRequest,
  CheckWordRequest,
} from "@huayi/protocol";

import type { ContentCommand } from "../shared/extension-messages.js";
import { OverlayController } from "./overlay/overlay-controller.js";
import { rectToOverlayAnchor } from "./overlay/position-overlay.js";
import type { OverlayAnchorRect } from "./overlay/overlay-state.js";
import { readSelection, type SelectionRequestInput } from "./selection/read-selection.js";

interface RuntimeMessageEvent {
  addListener(listener: (message: unknown) => void): void;
  removeListener(listener: (message: unknown) => void): void;
}

export interface ContentRuntime {
  onMessage: RuntimeMessageEvent;
  sendMessage(message: ContentCommand): Promise<unknown> | undefined;
}

export interface ContentScriptOptions {
  createRequestId?: () => string;
  document?: Document;
  getAnchorRect?: (range: Range) => OverlayAnchorRect;
  runtime?: ContentRuntime;
}

export interface ContentScriptInstance {
  controller: OverlayController;
  destroy(): void;
}

const RUNTIME_ERROR: AnalysisError = {
  code: "INTERNAL_ERROR",
  message: "扩展通信失败，请刷新页面后重试。",
  retryable: true,
};

type ActiveOperation = "analysis" | "wordbook-add" | "wordbook-check";

function wasHandled(response: unknown): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    "handled" in response &&
    response.handled === true
  );
}

function createChromeRuntime(): ContentRuntime {
  return {
    onMessage: {
      addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
      removeListener: (listener) => chrome.runtime.onMessage.removeListener(listener),
    },
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  };
}

function getRangeAnchorRect(range: Range): OverlayAnchorRect {
  const clientRects = Array.from(range.getClientRects());
  const visibleRect = [...clientRects]
    .reverse()
    .find((rect: DOMRect) => rect.width > 0 || rect.height > 0);
  return rectToOverlayAnchor(visibleRect ?? range.getBoundingClientRect());
}

function cameFromOverlay(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (target) => target instanceof HTMLElement && target.dataset.huayiOverlayHost !== undefined,
    );
}

export function createAnalyzeRequest(
  selection: SelectionRequestInput,
  action: AnalyzeAction,
  requestId: string,
): AnalyzeRequest {
  return analyzeRequestSchema.parse({
    action,
    context: selection.context,
    requestId,
    schemaVersion: SCHEMA_VERSION,
    selection: selection.selection,
    selectionKind: selection.selectionKind,
    targetLanguage: "zh-CN",
    type: "analyze",
  });
}

export function createAddWordRequest(
  selection: SelectionRequestInput,
  requestId: string,
): AddWordRequest {
  return addWordRequestSchema.parse({
    context: selection.wordbookContext,
    language: "en",
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "add-word",
    word: selection.selection,
  });
}

export function createCheckWordRequest(
  selection: SelectionRequestInput,
  requestId: string,
): CheckWordRequest {
  return checkWordRequestSchema.parse({
    language: "en",
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "check-word",
    word: selection.selection,
  });
}

export function initializeContentScript(options: ContentScriptOptions = {}): ContentScriptInstance {
  const documentRef = options.document ?? document;
  const runtime = options.runtime ?? createChromeRuntime();
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const getAnchorRect = options.getAnchorRect ?? getRangeAnchorRect;
  const activeRequests = new Map<string, ActiveOperation>();

  const rejectActiveRequest = (requestId: string, error: AnalysisError): boolean => {
    const operation = activeRequests.get(requestId);
    if (operation === undefined) {
      return false;
    }
    activeRequests.delete(requestId);
    if (operation === "wordbook-add") {
      controller.rejectWordbook(error);
    } else if (operation === "wordbook-check") {
      controller.rejectWordbookCheck();
    } else {
      controller.reject(error);
    }
    return true;
  };

  const sendCommand = (
    command: ContentCommand,
    requestId?: string,
    onRejectActiveRequest?: () => void,
  ): Promise<boolean> | undefined => {
    const rejectCommand = (): void => {
      if (requestId !== undefined && rejectActiveRequest(requestId, RUNTIME_ERROR)) {
        onRejectActiveRequest?.();
      }
    };
    try {
      const delivery = runtime.sendMessage(command);
      if (delivery === undefined) {
        return undefined;
      }
      return delivery.then(
        (response) => {
          const handled = wasHandled(response);
          if (!handled) {
            rejectCommand();
          }
          return handled;
        },
        () => {
          rejectCommand();
          return false;
        },
      );
    } catch {
      rejectCommand();
      return undefined;
    }
  };

  const cancelRequest = (requestId: string): void => {
    if (!activeRequests.delete(requestId)) {
      return;
    }
    sendCommand({ requestId, type: "CANCEL_REQUEST" });
  };

  const cancelOperations = (operation?: ActiveOperation): void => {
    for (const [requestId, activeOperation] of [...activeRequests]) {
      if (operation === undefined || activeOperation === operation) {
        cancelRequest(requestId);
      }
    }
  };

  const controller = new OverlayController({
    document: documentRef,
    onAddWord: (selection) => {
      cancelOperations("wordbook-check");
      const requestId = createRequestId();
      activeRequests.set(requestId, "wordbook-add");
      sendCommand(
        { request: createAddWordRequest(selection, requestId), type: "ADD_WORD_TO_EUDIC" },
        requestId,
      );
    },
    onAnalyze: (action, selection) => {
      cancelOperations();
      const requestId = createRequestId();
      activeRequests.set(requestId, "analysis");
      const acknowledgement = sendCommand(
        { request: createAnalyzeRequest(selection, action, requestId), type: "ANALYZE_SELECTION" },
        requestId,
        () => controller.rejectWordbookCheck(),
      );
      if (selection.selectionKind !== "word" || acknowledgement === undefined) {
        return;
      }
      void acknowledgement.then((handled) => {
        if (!handled || activeRequests.get(requestId) !== "analysis") {
          return;
        }
        const checkRequestId = createRequestId();
        activeRequests.set(checkRequestId, "wordbook-check");
        sendCommand(
          {
            request: createCheckWordRequest(selection, checkRequestId),
            type: "CHECK_WORD_IN_EUDIC",
          },
          checkRequestId,
        );
      });
    },
    onCancel: () => cancelOperations(),
  });

  const handleSelection = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key === "Escape") {
      return;
    }
    if (cameFromOverlay(event)) {
      return;
    }

    const reading = readSelection(documentRef.defaultView?.getSelection() ?? null);
    if (reading === null) {
      return;
    }

    controller.show(
      {
        context: reading.context,
        selection: reading.selection,
        selectionKind: reading.selectionKind,
        wordbookContext: reading.wordbookContext,
      },
      getAnchorRect(reading.range),
    );
  };

  const handleRuntimeMessage = (message: unknown): void => {
    const parsed = hostEventSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }
    const event = parsed.data;
    const operation = activeRequests.get(event.requestId);
    if (operation === undefined) {
      return;
    }

    if (event.type === "analysis-delta" && operation === "analysis") {
      controller.appendDelta(event);
    } else if (event.type === "result" && operation === "analysis") {
      activeRequests.delete(event.requestId);
      controller.resolve(event.result);
    } else if (event.type === "word-status" && operation === "wordbook-check") {
      activeRequests.delete(event.requestId);
      controller.resolveWordbookCheck(event.presence);
    } else if (event.type === "word-added" && operation === "wordbook-add") {
      activeRequests.delete(event.requestId);
      controller.resolveWordbook(event.outcome);
    } else if (event.type === "error") {
      rejectActiveRequest(event.requestId, event.error);
    }
  };

  documentRef.addEventListener("mouseup", handleSelection);
  documentRef.addEventListener("keyup", handleSelection);
  runtime.onMessage.addListener(handleRuntimeMessage);

  return {
    controller,
    destroy: () => {
      documentRef.removeEventListener("mouseup", handleSelection);
      documentRef.removeEventListener("keyup", handleSelection);
      runtime.onMessage.removeListener(handleRuntimeMessage);
      controller.destroy();
    },
  };
}

if (
  typeof chrome !== "undefined" &&
  typeof document !== "undefined" &&
  chrome.runtime?.id !== undefined
) {
  initializeContentScript();
}
