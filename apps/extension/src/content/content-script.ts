import { hostEventSchema } from "@huayi/protocol";
import type { AnalysisError } from "@huayi/protocol";

import type { ContentCommand, ShanbayCommand } from "../shared/extension-messages.js";
import {
  createAddWordRequest,
  createAnalyzeRequest,
  createCheckWordRequest,
} from "./content-request-factory.js";
import { ContentRequestLifetimes, type ActiveOperation } from "./content-request-lifetimes.js";
import { OverlayController } from "./overlay/overlay-controller.js";
import type { FrameScheduler } from "./overlay/frame-scheduler.js";
import { rectToOverlayAnchor } from "./overlay/position-overlay.js";
import type { OverlayAnchorRect } from "./overlay/overlay-state.js";
import { readSelection } from "./selection/read-selection.js";
import {
  isShanbayCollectionPage,
  ShanbaySyncController,
} from "./shanbay/shanbay-sync-controller.js";
import { isYouTubeHost } from "./youtube/caption-reader.js";
import { YouTubeCaptionController } from "./youtube/youtube-caption-controller.js";
import type { YouTubeCaptionBridge } from "./youtube/youtube-caption-bridge-client.js";

export {
  createAddWordRequest,
  createAnalyzeRequest,
  createCheckWordRequest,
} from "./content-request-factory.js";

interface RuntimeMessageEvent {
  addListener(listener: (message: unknown) => void): void;
  removeListener(listener: (message: unknown) => void): void;
}

export interface ContentRuntime {
  onMessage: RuntimeMessageEvent;
  sendMessage(message: ContentCommand | ShanbayCommand): Promise<unknown> | undefined;
}

export interface ContentScriptOptions {
  createRequestId?: () => string;
  document?: Document;
  frameScheduler?: FrameScheduler;
  getAnchorRect?: (range: Range) => OverlayAnchorRect;
  getYouTubeVideoId?: () => string | null;
  isYouTubeWatchPage?: () => boolean;
  runtime?: ContentRuntime;
  youtubeBridge?: YouTubeCaptionBridge;
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

export function initializeContentScript(options: ContentScriptOptions = {}): ContentScriptInstance {
  const documentRef = options.document ?? document;
  const runtime = options.runtime ?? createChromeRuntime();
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const getAnchorRect = options.getAnchorRect ?? getRangeAnchorRect;
  const requestLifetimes = new ContentRequestLifetimes();

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
    const activeRequest = requestLifetimes.complete(requestId);
    if (activeRequest === undefined) {
      return false;
    }
    if (activeRequest.attachedToView) {
      rejectOperation(activeRequest.operation, error);
    }
    return true;
  };

  const sendCommand = (
    command: ContentCommand,
    requestId?: string,
  ): Promise<boolean> | undefined => {
    const rejectCommand = (): void => {
      if (requestId !== undefined) {
        rejectActiveRequest(requestId, RUNTIME_ERROR);
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
    if (requestLifetimes.complete(requestId) === undefined) {
      return;
    }
    sendCommand({ requestId, type: "CANCEL_REQUEST" });
  };

  const sendCancellations = (requestIds: string[]): void => {
    for (const requestId of requestIds) {
      sendCommand({ requestId, type: "CANCEL_REQUEST" });
    }
  };

  const cancelOperation = (operation: ActiveOperation): void => {
    sendCancellations(requestLifetimes.cancelOperation(operation));
  };

  const closeViewRequests = (): void => {
    sendCancellations(requestLifetimes.closeView());
  };

  const failActiveRequest = (requestId: string): void => {
    const activeRequest = requestLifetimes.get(requestId);
    if (activeRequest === undefined) {
      return;
    }
    cancelRequest(requestId);
    if (activeRequest.attachedToView) {
      rejectOperation(activeRequest.operation, INVALID_RESPONSE_ERROR);
    }
  };

  const controller = new OverlayController({
    document: documentRef,
    onAddWord: (selection) => {
      cancelOperation("wordbook-check");
      const requestId = createRequestId();
      requestLifetimes.begin(requestId, "wordbook-add");
      sendCommand(
        { request: createAddWordRequest(selection, requestId), type: "ADD_WORD_TO_EUDIC" },
        requestId,
      );
    },
    onAnalyze: (action, selection) => {
      closeViewRequests();
      const requestId = createRequestId();
      requestLifetimes.begin(requestId, "analysis");
      const acknowledgement = sendCommand(
        { request: createAnalyzeRequest(selection, action, requestId), type: "ANALYZE_SELECTION" },
        requestId,
      );
      if (selection.selectionKind !== "word" || acknowledgement === undefined) {
        return;
      }
      const checkRequestId = createRequestId();
      requestLifetimes.begin(checkRequestId, "wordbook-check");
      sendCommand(
        {
          request: createCheckWordRequest(selection, checkRequestId),
          type: "CHECK_WORD_IN_EUDIC",
        },
        checkRequestId,
      );
      void acknowledgement.then((handled) => {
        if (!handled && requestLifetimes.get(checkRequestId)?.operation === "wordbook-check") {
          cancelRequest(checkRequestId);
          controller.rejectWordbookCheck();
        }
      });
    },
    onCancel: closeViewRequests,
  });

  const youtubeController =
    options.isYouTubeWatchPage !== undefined || isYouTubeHost(documentRef.location)
      ? new YouTubeCaptionController({
          ...(options.youtubeBridge === undefined ? {} : { bridge: options.youtubeBridge }),
          document: documentRef,
          ...(options.isYouTubeWatchPage === undefined
            ? {}
            : { isWatchPage: options.isYouTubeWatchPage }),
          ...(options.getYouTubeVideoId === undefined
            ? {}
            : { getVideoId: options.getYouTubeVideoId }),
          isOverlayVisible: () =>
            controller.state.status !== "closed" && controller.state.status !== "idle",
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

  const shanbayController = isShanbayCollectionPage(documentRef.location)
    ? new ShanbaySyncController({
        document: documentRef,
        sendMessage: (message) => runtime.sendMessage(message),
      })
    : null;

  const handleSelection = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key === "Escape") {
      return;
    }
    if (cameFromOverlay(event)) {
      return;
    }
    if (youtubeController?.containsEvent(event) === true) {
      return;
    }

    const reading = readSelection(documentRef.defaultView?.getSelection() ?? null);
    if (reading === null) {
      return;
    }

    youtubeController?.releaseSelectionForExternalInteraction();
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
    if (shanbayController?.handleMessage(message) === true) return;
    const parsed = hostEventSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }
    const event = parsed.data;
    const activeRequest = requestLifetimes.get(event.requestId);
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
      const completed = requestLifetimes.complete(event.requestId);
      if (completed?.attachedToView === true) {
        controller.resolve(event.result);
      }
    } else if (event.type === "word-status" && activeRequest.operation === "wordbook-check") {
      const completed = requestLifetimes.complete(event.requestId);
      if (completed?.attachedToView === true) {
        controller.resolveWordbookCheck(event.presence);
      }
    } else if (event.type === "word-added" && activeRequest.operation === "wordbook-add") {
      const completed = requestLifetimes.complete(event.requestId);
      if (completed?.attachedToView === true) {
        controller.resolveWordbook(event.outcome);
      }
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
      shanbayController?.destroy();
      sendCancellations(requestLifetimes.cancelAll());
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
