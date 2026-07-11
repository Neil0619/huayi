import {
  SCHEMA_VERSION,
  addWordRequestSchema,
  analyzeRequestSchema,
  hostEventSchema,
} from "@huayi/protocol";
import type { AddWordRequest, AnalysisError, AnalyzeAction, AnalyzeRequest } from "@huayi/protocol";

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

export function initializeContentScript(options: ContentScriptOptions = {}): ContentScriptInstance {
  const documentRef = options.document ?? document;
  const runtime = options.runtime ?? createChromeRuntime();
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const getAnchorRect = options.getAnchorRect ?? getRangeAnchorRect;
  let activeRequest: { id: string; operation: "analysis" | "wordbook" } | null = null;

  const rejectActiveRequest = (error: AnalysisError): void => {
    const operation = activeRequest?.operation;
    activeRequest = null;
    if (operation === "wordbook") {
      controller.rejectWordbook(error);
    } else if (operation === "analysis") {
      controller.reject(error);
    }
  };

  const sendCommand = (command: ContentCommand, requestId?: string): void => {
    try {
      const delivery = runtime.sendMessage(command);
      if (delivery !== undefined) {
        void delivery.catch(() => {
          if (requestId !== undefined && activeRequest?.id === requestId) {
            rejectActiveRequest(RUNTIME_ERROR);
          }
        });
      }
    } catch {
      if (requestId !== undefined && activeRequest?.id === requestId) {
        rejectActiveRequest(RUNTIME_ERROR);
      }
    }
  };

  const controller = new OverlayController({
    document: documentRef,
    onAddWord: (selection) => {
      const requestId = createRequestId();
      activeRequest = { id: requestId, operation: "wordbook" };
      sendCommand(
        { request: createAddWordRequest(selection, requestId), type: "ADD_WORD_TO_EUDIC" },
        requestId,
      );
    },
    onAnalyze: (action, selection) => {
      const requestId = createRequestId();
      activeRequest = { id: requestId, operation: "analysis" };
      sendCommand(
        { request: createAnalyzeRequest(selection, action, requestId), type: "ANALYZE_SELECTION" },
        requestId,
      );
    },
    onCancel: () => {
      if (activeRequest === null) {
        return;
      }
      const requestId = activeRequest.id;
      activeRequest = null;
      sendCommand({ requestId, type: "CANCEL_REQUEST" });
    },
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
    if (!parsed.success || parsed.data.requestId !== activeRequest?.id) {
      return;
    }

    if (parsed.data.type === "result" && activeRequest.operation === "analysis") {
      activeRequest = null;
      controller.resolve(parsed.data.result);
    } else if (parsed.data.type === "word-added" && activeRequest.operation === "wordbook") {
      activeRequest = null;
      controller.resolveWordbook(parsed.data.outcome);
    } else if (parsed.data.type === "error") {
      rejectActiveRequest(parsed.data.error);
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
