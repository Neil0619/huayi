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
import { isYouTubeHost } from "./youtube/caption-reader.js";
import { YouTubeCaptionController } from "./youtube/youtube-caption-controller.js";

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
  isYouTubeWatchPage?: () => boolean;
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

const INVALID_RESPONSE_ERROR: AnalysisError = {
  code: "INVALID_RESPONSE",
  message: "本机服务返回了与请求不匹配的数据。",
  retryable: false,
};

type ActiveOperation = "analysis" | "wordbook-add" | "wordbook-check";

interface ActiveRequest {
  nextSequence: number;
  operation: ActiveOperation;
}

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

function getSelectionAnchorRect(event: Event, rangeAnchor: OverlayAnchorRect): OverlayAnchorRect {
  if (
    !(event instanceof MouseEvent) ||
    (event.clientX === 0 && event.clientY === 0 && event.detail === 0)
  ) {
    return rangeAnchor;
  }
  return {
    ...rangeAnchor,
    left: event.clientX,
    right: event.clientX,
    width: 0,
  };
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
    sentenceContext: selection.sentenceContext,
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
  const activeRequests = new Map<string, ActiveRequest>();

  const rejectOperation = (operation: ActiveOperation, error: AnalysisError): void => {
    if (operation === "wordbook-add") {
      controller.rejectWordbook(error);
    } else if (operation === "wordbook-check") {
      controller.rejectWordbookCheck();
    } else {
      controller.reject(error);
    }
  };

  const rejectActiveRequest = (requestId: string, error: AnalysisError): boolean => {
    const activeRequest = activeRequests.get(requestId);
    if (activeRequest === undefined) {
      return false;
    }
    activeRequests.delete(requestId);
    rejectOperation(activeRequest.operation, error);
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
    for (const [requestId, activeRequest] of [...activeRequests]) {
      if (operation === undefined || activeRequest.operation === operation) {
        cancelRequest(requestId);
      }
    }
  };

  const failActiveRequest = (requestId: string): void => {
    const activeRequest = activeRequests.get(requestId);
    if (activeRequest === undefined) {
      return;
    }
    cancelRequest(requestId);
    rejectOperation(activeRequest.operation, INVALID_RESPONSE_ERROR);
  };

  const controller = new OverlayController({
    document: documentRef,
    onAddWord: (selection) => {
      cancelOperations("wordbook-check");
      const requestId = createRequestId();
      activeRequests.set(requestId, { nextSequence: 0, operation: "wordbook-add" });
      sendCommand(
        { request: createAddWordRequest(selection, requestId), type: "ADD_WORD_TO_EUDIC" },
        requestId,
      );
    },
    onAnalyze: (action, selection) => {
      cancelOperations();
      const requestId = createRequestId();
      activeRequests.set(requestId, { nextSequence: 0, operation: "analysis" });
      const acknowledgement = sendCommand(
        { request: createAnalyzeRequest(selection, action, requestId), type: "ANALYZE_SELECTION" },
        requestId,
        () => controller.rejectWordbookCheck(),
      );
      if (selection.selectionKind !== "word" || acknowledgement === undefined) {
        return;
      }
      void acknowledgement.then((handled) => {
        if (!handled || activeRequests.get(requestId)?.operation !== "analysis") {
          return;
        }
        const checkRequestId = createRequestId();
        activeRequests.set(checkRequestId, { nextSequence: 0, operation: "wordbook-check" });
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

  const youtubeController =
    options.isYouTubeWatchPage !== undefined || isYouTubeHost(documentRef.location)
      ? new YouTubeCaptionController({
          document: documentRef,
          ...(options.isYouTubeWatchPage === undefined
            ? {}
            : { isWatchPage: options.isYouTubeWatchPage }),
          onPresentationChange: () => controller.refreshPresentation(),
          onSelection: ({ anchorRect, input, presentation }) => {
            controller.show(input, anchorRect, presentation);
          },
          onSessionClose: () => controller.close(),
          onWarmup: () => {
            void sendCommand({ type: "WARMUP_HOST" });
          },
        })
      : null;

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

    const anchorRect = getSelectionAnchorRect(event, getAnchorRect(reading.range));
    controller.show(
      {
        context: reading.context,
        selection: reading.selection,
        selectionKind: reading.selectionKind,
        sentenceContext: reading.sentenceContext,
        wordbookContext: reading.wordbookContext,
      },
      anchorRect,
    );
    void sendCommand({ type: "WARMUP_HOST" });
  };

  const handleRuntimeMessage = (message: unknown): void => {
    const parsed = hostEventSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }
    const event = parsed.data;
    const activeRequest = activeRequests.get(event.requestId);
    if (activeRequest === undefined) {
      return;
    }

    const isAnalysisUpdate = event.type === "analysis-delta" || event.type === "analysis-section";
    if (isAnalysisUpdate) {
      if (activeRequest.operation !== "analysis" || event.sequence !== activeRequest.nextSequence) {
        failActiveRequest(event.requestId);
        return;
      }
      activeRequest.nextSequence += 1;
      controller.appendUpdate(event);
    } else if (event.type === "result" && activeRequest.operation === "analysis") {
      activeRequests.delete(event.requestId);
      controller.resolve(event.result);
    } else if (event.type === "word-status" && activeRequest.operation === "wordbook-check") {
      activeRequests.delete(event.requestId);
      controller.resolveWordbookCheck(event.presence);
    } else if (event.type === "word-added" && activeRequest.operation === "wordbook-add") {
      activeRequests.delete(event.requestId);
      controller.resolveWordbook(event.outcome);
    } else if (event.type === "error") {
      rejectActiveRequest(event.requestId, event.error);
    } else if (event.type !== "progress") {
      failActiveRequest(event.requestId);
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
      youtubeController?.destroy();
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
