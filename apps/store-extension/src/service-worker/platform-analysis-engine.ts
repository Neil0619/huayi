import {
  analysisResultSchema,
  analysisUpdateSchema,
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
    return new BrowserAnalysisError(
      "invalid-response",
      error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
    );
  }
  switch (error.kind) {
    case "authentication":
      return new BrowserAnalysisError(
        "cloud-session-required",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
    case "forbidden":
      return new BrowserAnalysisError(
        "cloud-access-denied",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
    case "client-upgrade-required":
      return new BrowserAnalysisError(
        "version-mismatch",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
    case "quota-exhausted":
      return new BrowserAnalysisError(
        "quota-exhausted",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
    case "transient":
      return new BrowserAnalysisError(
        "network-error",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
    case "invalid-response":
      return new BrowserAnalysisError(
        "invalid-response",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
    default:
      return new BrowserAnalysisError(
        "provider-error",
        error instanceof CloudExtensionQueryError ? error.diagnosticId : undefined,
      );
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
      if (session === null) throw new BrowserAnalysisError("cloud-session-required");
      const controller = new AbortController();
      const browserSignal = signal as Partial<AbortSignal>;
      const abort = () => controller.abort();
      if (signal.aborted) controller.abort();
      browserSignal.addEventListener?.("abort", abort, { once: true });
      let generationId: string | null = null;
      let sequence = -1;
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
          if (event.type === "query.preview" || event.type === "query.preview-v2") {
            if (event.type === "query.preview-v2" && event.update.requestId !== generationId)
              throw new CloudExtensionQueryError("invalid-response");
            const update = analysisUpdateSchema.safeParse(
              event.type === "query.preview-v2"
                ? { ...event.update, requestId: request.requestId }
                : {
                    requestId: request.requestId,
                    type: "delta",
                    section: event.section,
                    sequence: event.sequence,
                    text: event.text,
                  },
            );
            if (!update.success) throw new CloudExtensionQueryError("invalid-response");
            if (update.data.type !== "progress") {
              if (update.data.sequence <= sequence)
                throw new CloudExtensionQueryError("invalid-response");
              sequence = update.data.sequence;
            }
            onUpdate(update.data);
            continue;
          }
          if (event.type === "query.failed") {
            throw new CloudExtensionQueryError(
              event.error.code === "quota_exhausted"
                ? "quota-exhausted"
                : event.error.code === "model_output_invalid"
                  ? "invalid-response"
                  : "permanent",
              event.generationId,
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
        if (signal.aborted && !(error instanceof CloudExtensionQueryError))
          throw new BrowserAnalysisError("cancelled");
        throw publicError(error);
      } finally {
        browserSignal.removeEventListener?.("abort", abort);
      }
    },
  };
}
