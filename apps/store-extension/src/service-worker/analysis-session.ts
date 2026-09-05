import {
  STORE_MESSAGE_VERSION,
  isSiteEnabled,
  parseAnalysisClientMessage,
  parseAnalysisServerMessage,
  type AnalysisEngine,
  type StoreAnalysisErrorCode,
  type StoreAnalysisServerMessage,
  type StoreSettings,
} from "@huayi/store-domain";

import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import { createTrustedAnalysisRequest } from "./selection-request.js";

interface Listener<T> {
  addListener(listener: T): void;
}

export interface AnalysisSessionPort {
  readonly onDisconnect: Listener<() => void>;
  readonly onMessage: Listener<(message: unknown) => void>;
  postMessage(message: StoreAnalysisServerMessage): void;
}

export interface AnalysisSessionDependencies {
  readonly analysisEngine: AnalysisEngine;
  readonly cancelAnalysis?: (requestId: string) => void;
  readonly createRequestId: () => string;
  readonly getSettings: () => Promise<StoreSettings>;
  readonly siteHost: string | null;
}

const PUBLIC_ENGINE_ERROR_CODES: readonly StoreAnalysisErrorCode[] = [
  "cancelled",
  "cloud-access-denied",
  "cloud-session-required",
  "credential-missing",
  "invalid-response",
  "network-error",
  "provider-error",
  "quota-exhausted",
  "timeout",
  "version-mismatch",
];

function isVersionMismatch(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "messageVersion" in message &&
    message.messageVersion !== STORE_MESSAGE_VERSION
  );
}

export function createAnalysisSession(
  port: AnalysisSessionPort,
  dependencies: AnalysisSessionDependencies,
): void {
  let abortController: AbortController | undefined;
  let closed = false;
  let started = false;
  let terminal = false;
  let requestId: string | null = null;

  const post = (message: StoreAnalysisServerMessage): void => {
    if (closed) return;
    try {
      port.postMessage(parseAnalysisServerMessage(message));
    } catch {
      closed = true;
      abortController?.abort();
    }
  };

  const fail = (code: StoreAnalysisErrorCode, diagnosticId?: string): void => {
    if (terminal || closed) return;
    terminal = true;
    post({
      code,
      ...(diagnosticId ? { diagnosticId } : {}),
      messageVersion: STORE_MESSAGE_VERSION,
      requestId,
      type: "store/analysis-error",
    });
  };

  const run = async (message: unknown): Promise<void> => {
    let parsed;
    try {
      parsed = parseAnalysisClientMessage(message);
    } catch {
      fail(isVersionMismatch(message) ? "version-mismatch" : "invalid-request");
      return;
    }
    if (parsed.type === "store/analysis-cancel") {
      if (requestId !== null && dependencies.cancelAnalysis) {
        dependencies.cancelAnalysis(requestId);
        return;
      }
      abortController?.abort();
      fail("cancelled");
      return;
    }
    if (started) {
      abortController?.abort();
      fail("busy");
      return;
    }
    started = true;
    abortController = new AbortController();

    let settings: StoreSettings;
    try {
      settings = await dependencies.getSettings();
    } catch {
      fail("internal-error");
      return;
    }
    if (closed || terminal) return;
    if (dependencies.siteHost === null || !isSiteEnabled(settings, dependencies.siteHost)) {
      fail("invalid-request");
      return;
    }
    if (settings.networkConsent === null) {
      fail("consent-required");
      return;
    }

    let generatedRequestId: string;
    try {
      generatedRequestId = dependencies.createRequestId();
      requestId = generatedRequestId;
    } catch {
      requestId = null;
      fail("internal-error");
      return;
    }
    let request;
    try {
      request = createTrustedAnalysisRequest(parsed, settings, generatedRequestId);
    } catch {
      requestId = null;
      fail("invalid-request");
      return;
    }

    try {
      const result = await dependencies.analysisEngine.analyze(
        request,
        abortController.signal,
        (update) => {
          if (closed || terminal) return;
          if (update.requestId !== requestId) {
            abortController?.abort();
            fail("invalid-response");
            return;
          }
          post({ messageVersion: STORE_MESSAGE_VERSION, type: "store/analysis-update", update });
        },
      );
      if (closed || terminal) return;
      if (result.requestId !== requestId) {
        fail("invalid-response");
        return;
      }
      terminal = true;
      post({ messageVersion: STORE_MESSAGE_VERSION, result, type: "store/analysis-result" });
    } catch (error) {
      if (closed || terminal) return;
      if (error instanceof BrowserAnalysisError && PUBLIC_ENGINE_ERROR_CODES.includes(error.code)) {
        fail(error.code, error.diagnosticId);
      } else if (abortController.signal.aborted) {
        fail("cancelled");
      } else {
        fail("internal-error");
      }
    }
  };

  port.onMessage.addListener((message) => {
    void run(message);
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    abortController?.abort();
  });
}
