import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { analysisResultSchema } from "@huayi/protocol";
import type { AnalysisDeltaSection, AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import {
  CodexProviderError,
  capabilityMissingError,
  invalidResponseError,
  mapCodexProcessFailure,
  mapCodexTurnFailure,
} from "../runtime/error-mapper.js";
import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

const STREAM_FIELDS = {
  "explain-lexical": new Map<string, AnalysisDeltaSection>([
    ["contextualMeaningZh", "contextual-meaning"],
  ]),
  "explain-sentence": new Map<string, AnalysisDeltaSection>([
    ["mainStructure", "main-structure"],
    ["translationZh", "translation"],
    ["contextRole", "context-role"],
  ]),
  "translate-lexical": new Map<string, AnalysisDeltaSection>([
    ["contextualMeaningZh", "contextual-meaning"],
  ]),
  "translate-passage": new Map<string, AnalysisDeltaSection>([["translationZh", "translation"]]),
} satisfies Record<AnalysisResult["type"], Map<string, AnalysisDeltaSection>>;

export interface CodexAppServerProviderOptions {
  appServer: CodexAppServer;
  schemaDirectory: string;
}

function cancelledError(): CodexProviderError {
  return mapCodexProcessFailure({ aborted: true, exitCode: null, stderr: "" });
}

function resultTypeFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): AnalysisResult["type"] {
  const lexical = request.selectionKind === "word" || request.selectionKind === "phrase";
  if (request.action === "translate") {
    return lexical ? "translate-lexical" : "translate-passage";
  }
  if (lexical) return "explain-lexical";
  if (request.selectionKind === "sentence") return "explain-sentence";
  throw new CodexProviderError("UNSUPPORTED_SELECTION", "当前选区不支持该操作。", false);
}

export function outputSchemaFilenameFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): string {
  return `${resultTypeFor(request)}.json`;
}

function parseResult(finalText: string, request: AnalyzeRequest): AnalysisResult {
  let rawResult: unknown;
  try {
    rawResult = JSON.parse(finalText);
  } catch (error) {
    throw invalidResponseError(error);
  }
  const parsed = analysisResultSchema.safeParse(rawResult);
  if (!parsed.success) throw invalidResponseError(parsed.error);
  if (
    parsed.data.type !== resultTypeFor(request) ||
    parsed.data.selectionKind !== request.selectionKind ||
    parsed.data.sourceText !== request.selection
  ) {
    throw invalidResponseError();
  }
  return parsed.data;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CodexAppServerProvider implements AnalysisProvider {
  readonly #appServer: CodexAppServer;
  readonly #schemaDirectory: string;
  readonly #schemas = new Map<string, Promise<Record<string, unknown>>>();
  #disposed = false;

  constructor(options: CodexAppServerProviderOptions) {
    if (!isAbsolute(options.schemaDirectory)) {
      throw new TypeError("Codex schema directory must be an absolute path.");
    }
    this.#appServer = options.appServer;
    this.#schemaDirectory = options.schemaDirectory;
  }

  async analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    if (signal.aborted) throw cancelledError();
    const resultType = resultTypeFor(request);
    const outputSchema = await this.#loadSchema(`${resultType}.json`);
    if (signal.aborted) throw cancelledError();

    const extractor = new StreamingJsonFieldExtractor(STREAM_FIELDS[resultType]);
    let extractionFailure: unknown;
    let finalText: string;
    try {
      finalText = await this.#appServer.runTurn({
        onAssistantDelta: (delta) => {
          if (extractionFailure !== undefined) return;
          let chunks;
          try {
            chunks = extractor.push(delta);
          } catch (error) {
            extractionFailure = error;
            return;
          }
          for (const chunk of chunks) onDelta?.(chunk);
        },
        outputSchema,
        prompt: buildAnalysisPrompt(request),
        requestId: request.requestId,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw cancelledError();
      if (error instanceof CodexProviderError) throw error;
      throw mapCodexTurnFailure(error);
    }

    if (extractionFailure !== undefined) throw invalidResponseError(extractionFailure);
    try {
      extractor.finish();
    } catch (error) {
      throw invalidResponseError(error);
    }
    return parseResult(finalText, request);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#appServer.dispose();
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
