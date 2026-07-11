import { SCHEMA_VERSION } from "@huayi/protocol";
import type {
  AddWordRequest,
  AnalysisError,
  AnalysisResult,
  AnalyzeRequest,
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
import { MockNativeTransport } from "./mock-native-transport.js";

const TAB_ID = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 65_000;
const PENDING_SELECTION = "pending request";
const RETRY_SELECTION = "temporary failure";
const TIMEOUT_SELECTION = "timeout request";
const PENDING_WORDBOOK_WORD = "pendingword";

const configuredRequestTimeoutMs = new URLSearchParams(window.location.search).get(
  "request-timeout-ms",
);
const requestTimeoutMs =
  configuredRequestTimeoutMs === null
    ? DEFAULT_REQUEST_TIMEOUT_MS
    : Number(configuredRequestTimeoutMs);

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

function lexicalTranslation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "word" && request.selectionKind !== "phrase") {
    throw new Error("Lexical translation requires a word or phrase.");
  }

  return {
    collocations: [
      { meaningZh: "测试搭配一", text: "sample collocation" },
      { meaningZh: "测试搭配二", text: "common collocation" },
      { meaningZh: "测试搭配三", text: "useful collocation" },
    ],
    contextualMeaningZh: "词汇翻译结果",
    partOfSpeech: request.selectionKind === "word" ? "noun" : "phrase",
    pronunciation: { uk: "/mock/", us: "/mock/" },
    selectionKind: request.selectionKind,
    similarTerms: [
      { meaningZh: "相近表达一", partOfSpeech: "noun", text: "alternative" },
      { meaningZh: "相近表达二", partOfSpeech: "noun", text: "equivalent" },
      { meaningZh: "相近表达三", partOfSpeech: "noun", text: "counterpart" },
    ],
    sourceText: request.selection,
    type: "translate-lexical",
  };
}

function passageTranslation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "sentence" && request.selectionKind !== "paragraph") {
    throw new Error("Passage translation requires a sentence or paragraph.");
  }

  return {
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    translationZh: "段落翻译结果",
    type: "translate-passage",
  };
}

function lexicalExplanation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "word" && request.selectionKind !== "phrase") {
    throw new Error("Lexical explanation requires a word or phrase.");
  }

  return {
    baseForm: "sustain",
    collocations: [
      { meaningZh: "测试搭配一", text: "sample collocation" },
      { meaningZh: "测试搭配二", text: "common collocation" },
    ],
    contextualMeaningZh: "词汇解释结果",
    coreMeanings: [{ meaningZh: "核心词义", partOfSpeech: "verb" }],
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    synonyms: [
      { meaningZh: "同义表达一", partOfSpeech: "adjective", text: "continuous" },
      { meaningZh: "同义表达二", partOfSpeech: "adjective", text: "prolonged" },
      { meaningZh: "同义表达三", partOfSpeech: "adjective", text: "uninterrupted" },
    ],
    type: "explain-lexical",
    wordFormation: "模拟构词说明",
  };
}

function sentenceExplanation(request: AnalyzeRequest): AnalysisResult {
  if (request.selectionKind !== "sentence") {
    throw new Error("Sentence explanation requires a sentence.");
  }

  return {
    contextRole: "说明这句话在上下文中的语境作用。",
    keyExpressions: [{ meaningZh: "关键表达含义", text: "in its early stages" }],
    mainStructure: "句子解释主干",
    selectionKind: "sentence",
    sourceText: request.selection,
    translationZh: "句子解释译文",
    type: "explain-sentence",
  };
}

function resultFor(request: AnalyzeRequest): AnalysisResult {
  if (request.action === "translate") {
    return request.selectionKind === "word" || request.selectionKind === "phrase"
      ? lexicalTranslation(request)
      : passageTranslation(request);
  }

  return request.selectionKind === "sentence"
    ? sentenceExplanation(request)
    : lexicalExplanation(request);
}

function appendRequestLog(log: HTMLOListElement, request: HostRequest): void {
  const entry = document.createElement("li");
  entry.dataset.nativeRequest = request.type;
  entry.dataset.requestId = request.requestId;

  if (request.type === "analyze") {
    entry.dataset.analysisAction = request.action;
    entry.dataset.selectionKind = request.selectionKind;
    entry.dataset.selectionText = request.selection;
  } else if (request.type === "cancel") {
    entry.dataset.targetRequestId = request.targetRequestId;
  } else if (request.type === "add-word") {
    entry.dataset.word = request.word;
    entry.dataset.wordbookContext = request.context;
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

function createResultEvent(request: AnalyzeRequest): HostEvent {
  return {
    requestId: request.requestId,
    result: resultFor(request),
    schemaVersion: SCHEMA_VERSION,
    type: "result",
  };
}

const requestLog = document.querySelector<HTMLOListElement>("[data-native-request-log]");
if (requestLog === null) {
  throw new Error("The E2E fixture must provide a native request log.");
}

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

  queueMicrotask(() => {
    if (request.selection === RETRY_SELECTION && attempt === 1) {
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
      return;
    }

    transport.emit(createResultEvent(request));
  });
});

initializeContentScript({
  createRequestId: () => `e2e-content-${(contentRequestSequence += 1)}`,
  runtime,
});
