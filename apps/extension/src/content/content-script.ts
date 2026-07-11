import { SCHEMA_VERSION, analyzeRequestSchema, hostEventSchema } from "@huayi/protocol";
import type { AnalysisError, AnalyzeAction, AnalyzeRequest } from "@huayi/protocol";

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

export function initializeContentScript(options: ContentScriptOptions = {}): ContentScriptInstance {
  const documentRef = options.document ?? document;
  const runtime = options.runtime ?? createChromeRuntime();
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const getAnchorRect = options.getAnchorRect ?? getRangeAnchorRect;
  let activeRequestId: string | null = null;

  const sendCommand = (command: ContentCommand, requestId?: string): void => {
    try {
      const delivery = runtime.sendMessage(command);
      if (delivery !== undefined) {
        void delivery.catch(() => {
          if (requestId !== undefined && activeRequestId === requestId) {
            activeRequestId = null;
            controller.reject(RUNTIME_ERROR);
          }
        });
      }
    } catch {
      if (requestId !== undefined && activeRequestId === requestId) {
        activeRequestId = null;
        controller.reject(RUNTIME_ERROR);
      }
    }
  };

  const controller = new OverlayController({
    document: documentRef,
    onAnalyze: (action, selection) => {
      const requestId = createRequestId();
      activeRequestId = requestId;
      sendCommand(
        { request: createAnalyzeRequest(selection, action, requestId), type: "ANALYZE_SELECTION" },
        requestId,
      );
    },
    onCancel: () => {
      if (activeRequestId === null) {
        return;
      }
      const requestId = activeRequestId;
      activeRequestId = null;
      sendCommand({ requestId, type: "CANCEL_ANALYSIS" });
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
    if (!parsed.success || parsed.data.requestId !== activeRequestId) {
      return;
    }

    if (parsed.data.type === "result") {
      activeRequestId = null;
      controller.resolve(parsed.data.result);
    } else if (parsed.data.type === "error") {
      activeRequestId = null;
      controller.reject(parsed.data.error);
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
