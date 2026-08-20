import {
  analysisResultSchema,
  type AnalysisCancellationSignal,
  type AnalysisEngine,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalysisUpdateListener,
} from "@huayi/store-domain";
import type { ExtensionQueryRequest } from "@huayi/cloud-contracts";

import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import {
  CloudExtensionQueryError,
  type CloudExtensionQueryApi,
} from "./cloud-extension-query-api.js";

interface PlatformAnalysisEngineOptions {
  readonly api: Pick<CloudExtensionQueryApi, "start">;
  readonly readSession: () => Promise<{ readonly token: string } | null>;
  readonly sourceType: "web-selection" | "youtube-caption";
}

function expectedType(request: AnalysisRequest): AnalysisResult["type"] {
  if (request.selectionKind === "word") {
    return request.action === "translate" ? "translate-word" : "explain-word";
  }
  if (request.selectionKind === "phrase") {
    return request.action === "translate" ? "translate-lexical" : "explain-lexical";
  }
  return request.action === "translate" ? "translate-passage" : "explain-sentence";
}

function publicError(error: unknown): BrowserAnalysisError {
  if (!(error instanceof CloudExtensionQueryError)) {
    return new BrowserAnalysisError("invalid-response");
  }
  switch (error.kind) {
    case "authentication":
      return new BrowserAnalysisError("credential-missing");
    case "quota-exhausted":
      return new BrowserAnalysisError("quota-exhausted");
    case "transient":
      return new BrowserAnalysisError("network-error");
    case "invalid-response":
      return new BrowserAnalysisError("invalid-response");
    default:
      return new BrowserAnalysisError("provider-error");
  }
}

function queryInput(
  request: AnalysisRequest,
  sourceType: PlatformAnalysisEngineOptions["sourceType"],
): ExtensionQueryRequest {
  return {
    action: request.action,
    selectionKind: request.selectionKind,
    ...(request.sentenceContext === null ? {} : { sentenceContext: request.sentenceContext }),
    sourceText: request.selection,
    sourceType,
  };
}

export function createPlatformAnalysisEngine(
  options: PlatformAnalysisEngineOptions,
): AnalysisEngine {
  return {
    async analyze(
      request: AnalysisRequest,
      signal: AnalysisCancellationSignal,
      onUpdate: AnalysisUpdateListener,
    ): Promise<AnalysisResult> {
      const session = await options.readSession();
      if (session === null) throw new BrowserAnalysisError("credential-missing");
      const controller = new AbortController();
      const browserSignal = signal as Partial<AbortSignal>;
      const abort = () => controller.abort();
      if (signal.aborted) controller.abort();
      browserSignal.addEventListener?.("abort", abort, { once: true });
      let generationId: string | null = null;
      try {
        for await (const event of options.api.start(
          queryInput(request, options.sourceType),
          request.requestId,
          session.token,
          controller.signal,
        )) {
          if (event.type === "query.started") {
            if (generationId !== null) throw new Error("Duplicate start event.");
            generationId = event.generationId;
            onUpdate({ requestId: request.requestId, stage: "running", type: "progress" });
            continue;
          }
          if (generationId === null || event.generationId !== generationId) {
            throw new Error("Mismatched generation.");
          }
          if (event.type === "query.preview") continue;
          if (event.type === "query.failed") {
            throw new CloudExtensionQueryError(
              event.error.code === "quota_exhausted" ? "quota-exhausted" : "permanent",
            );
          }
          const result = analysisResultSchema.parse({
            ...event.result,
            requestId: request.requestId,
            sourceText: request.selection,
          });
          if (result.type !== expectedType(request)) throw new Error("Mismatched result type.");
          if (
            "selectionKind" in result &&
            (request.selectionKind === "sentence" || request.selectionKind === "passage") &&
            result.selectionKind !== request.selectionKind
          ) {
            throw new Error("Mismatched selection kind.");
          }
          return result;
        }
        throw new Error("Missing terminal event.");
      } catch (error) {
        if (signal.aborted) throw new BrowserAnalysisError("cancelled");
        throw publicError(error);
      } finally {
        browserSignal.removeEventListener?.("abort", abort);
      }
    },
  };
}
