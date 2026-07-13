import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import {
  CodexProviderError,
  capabilityMissingError,
  mapCodexProcessFailure,
  mapCodexTurnFailure,
  mapProviderValidationFailure,
} from "../runtime/error-mapper.js";
import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";
import { resultTypeFor } from "./model-analysis-schemas.js";
import { parseAndAssembleModelResult } from "./model-result-assembler.js";
import {
  ProviderValidationError,
  providerValidationDiagnostic,
  type ProviderValidationDiagnosticSink,
} from "./provider-validation.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

export interface CodexAppServerProviderOptions {
  appServer: CodexAppServer;
  onValidationDiagnostic?: ProviderValidationDiagnosticSink;
  schemaDirectory: string;
}

function cancelledError(): CodexProviderError {
  return mapCodexProcessFailure({ aborted: true, exitCode: null, stderr: "" });
}

function providerResultTypeFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): AnalysisResult["type"] {
  try {
    return resultTypeFor(request);
  } catch {
    throw new CodexProviderError("UNSUPPORTED_SELECTION", "当前选区不支持该操作。", false);
  }
}

export function outputSchemaFilenameFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): string {
  return `${providerResultTypeFor(request)}.json`;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CodexAppServerProvider implements AnalysisProvider {
  readonly #appServer: CodexAppServer;
  readonly #onValidationDiagnostic: ProviderValidationDiagnosticSink | undefined;
  readonly #schemaDirectory: string;
  readonly #schemas = new Map<string, Promise<Record<string, unknown>>>();
  #disposed = false;

  constructor(options: CodexAppServerProviderOptions) {
    if (!isAbsolute(options.schemaDirectory)) {
      throw new TypeError("Codex schema directory must be an absolute path.");
    }
    this.#appServer = options.appServer;
    this.#onValidationDiagnostic = options.onValidationDiagnostic;
    this.#schemaDirectory = options.schemaDirectory;
  }

  async analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    if (signal.aborted) throw cancelledError();
    const resultType = providerResultTypeFor(request);
    const outputSchema = await this.#loadSchema(`${resultType}.json`);
    if (signal.aborted) throw cancelledError();

    const extractor = new StreamingJsonFieldExtractor({
      resultType,
      sentenceContext: request.sentenceContext,
    });
    let extractionFailure: ProviderValidationError | undefined;
    let interruptStarted = false;
    const recordExtractionFailure = (failure: ProviderValidationError): void => {
      if (extractionFailure !== undefined) return;
      extractionFailure = failure;
      if (interruptStarted) return;
      interruptStarted = true;
      try {
        void this.#appServer.interrupt(request.requestId).catch(() => undefined);
      } catch {
        // A failed best-effort interrupt must not replace the validation failure.
      }
    };
    let finalText: string;
    try {
      finalText = await this.#appServer.runTurn({
        onAssistantDelta: (delta) => {
          if (extractionFailure !== undefined) return;
          let updates;
          try {
            updates = extractor.push(delta);
          } catch (error) {
            recordExtractionFailure(
              error instanceof ProviderValidationError
                ? error
                : new ProviderValidationError("stream-parse", { cause: error }),
            );
            return;
          }
          for (const update of updates) onDelta?.(update);
        },
        outputSchema,
        prompt: buildAnalysisPrompt(request),
        requestId: request.requestId,
        signal,
      });
    } catch (error) {
      if (extractionFailure !== undefined) this.#failValidation(extractionFailure);
      if (signal.aborted) throw cancelledError();
      if (error instanceof CodexProviderError) throw error;
      throw mapCodexTurnFailure(error);
    }

    if (extractionFailure !== undefined) this.#failValidation(extractionFailure);
    try {
      extractor.finish();
    } catch (error) {
      const failure =
        error instanceof ProviderValidationError
          ? error
          : new ProviderValidationError("stream-parse", { cause: error });
      recordExtractionFailure(failure);
      this.#failValidation(failure);
    }
    try {
      return parseAndAssembleModelResult(finalText, request);
    } catch (error) {
      if (error instanceof ProviderValidationError) this.#failValidation(error);
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#appServer.dispose();
  }

  #failValidation(failure: ProviderValidationError): never {
    try {
      this.#onValidationDiagnostic?.(providerValidationDiagnostic(failure));
    } catch {
      // Diagnostics must never replace the fixed public validation error.
    }
    throw mapProviderValidationFailure(failure);
  }

  #loadSchema(filename: string): Promise<Record<string, unknown>> {
    const cached = this.#schemas.get(filename);
    if (cached !== undefined) return cached;
    const pending = readFile(join(this.#schemaDirectory, filename), "utf8")
      .then((source) => {
        const schema: unknown = JSON.parse(source);
        if (!isJsonObject(schema)) throw new SyntaxError("Output schema must be a JSON object.");
        return schema;
      })
      .catch((error: unknown) => {
        throw capabilityMissingError(error);
      });
    this.#schemas.set(filename, pending);
    return pending;
  }
}
