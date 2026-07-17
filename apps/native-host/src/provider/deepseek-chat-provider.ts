import { Buffer } from "node:buffer";

import { MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import { DeepSeekCredentialError } from "../credentials/deepseek-keychain.js";
import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";
import type { DeepSeekChatClient } from "./deepseek-chat-client.js";
import type { DeepSeekChatEvent } from "./deepseek-chat-events.js";
import { DeepSeekProviderError, deepSeekProviderError } from "./deepseek-provider-errors.js";
import { resultTypeFor, type ModelResultType } from "./model-analysis-schemas.js";
import type { ModelSchemaRepository } from "./model-schema-repository.js";
import { parseAndAssembleModelResult } from "./model-result-assembler.js";
import {
  ProviderValidationError,
  providerValidationDiagnostic,
  type ProviderValidationDiagnosticSink,
} from "./provider-validation.js";
import type { DeepSeekChatRequest } from "./deepseek-request-body.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

export interface DeepSeekChatProviderOptions {
  readonly apiKeyReader: DeepSeekCredentialReader;
  readonly client: DeepSeekChatClient;
  readonly onValidationDiagnostic?: ProviderValidationDiagnosticSink;
  readonly schemaRepository: ModelSchemaRepository;
}

export interface DeepSeekCredentialReader {
  read(signal: AbortSignal): Promise<string>;
}

interface StreamState {
  accumulatedText: string;
  created?: number;
  done: boolean;
  id?: string;
  started: boolean;
  stopped: boolean;
}

function invalidResponse(): never {
  throw deepSeekProviderError("INVALID_RESPONSE");
}

function requireLifecycle(condition: boolean): void {
  if (!condition) invalidResponse();
}

function resultTypeForRequest(request: AnalyzeRequest): ModelResultType {
  try {
    return resultTypeFor(request);
  } catch {
    return invalidResponse();
  }
}

export class DeepSeekChatProvider implements AnalysisProvider {
  readonly #apiKeyReader: DeepSeekCredentialReader;
  readonly #client: DeepSeekChatClient;
  readonly #onValidationDiagnostic: ProviderValidationDiagnosticSink | undefined;
  readonly #schemaRepository: ModelSchemaRepository;

  constructor(options: DeepSeekChatProviderOptions) {
    this.#apiKeyReader = options.apiKeyReader;
    this.#client = options.client;
    this.#onValidationDiagnostic = options.onValidationDiagnostic;
    this.#schemaRepository = options.schemaRepository;
  }

  warmup(signal: AbortSignal): Promise<void> {
    return signal.aborted ? Promise.reject(deepSeekProviderError("CANCELLED")) : Promise.resolve();
  }

  async analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    if (signal.aborted) throw deepSeekProviderError("CANCELLED");
    const resultType = resultTypeForRequest(request);
    try {
      const key = await this.#apiKeyReader.read(signal);
      if (signal.aborted) throw deepSeekProviderError("CANCELLED");
      const outputSchema = await this.#schemaRepository.load(`${resultType}.json`);
      if (signal.aborted) throw deepSeekProviderError("CANCELLED");
      const chatRequest: DeepSeekChatRequest = {
        analysisRequest: request,
        outputSchema,
        resultType,
      };
      return await this.#consume(
        this.#client.stream(chatRequest, key, signal),
        request,
        resultType,
        signal,
        onDelta,
      );
    } catch (error) {
      if (error instanceof ProviderValidationError) this.#failValidation(error);
      if (error instanceof DeepSeekProviderError || error instanceof DeepSeekCredentialError) {
        throw error;
      }
      if (signal.aborted) throw deepSeekProviderError("CANCELLED");
      throw deepSeekProviderError("INTERNAL_ERROR");
    }
  }

  async #consume(
    events: AsyncIterable<DeepSeekChatEvent>,
    request: AnalyzeRequest,
    resultType: ModelResultType,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    const extractor = new StreamingJsonFieldExtractor({
      resultType,
      sentenceContext: request.sentenceContext,
    });
    const state: StreamState = { accumulatedText: "", done: false, started: false, stopped: false };
    for await (const event of events) {
      if (signal.aborted) throw deepSeekProviderError("CANCELLED");
      this.#consumeEvent(event, state, extractor, onDelta);
    }
    requireLifecycle(
      state.started && state.stopped && state.done && state.accumulatedText.length > 0,
    );
    extractor.finish();
    return parseAndAssembleModelResult(state.accumulatedText, request);
  }

  #consumeEvent(
    event: DeepSeekChatEvent,
    state: StreamState,
    extractor: StreamingJsonFieldExtractor,
    onDelta?: AnalysisStreamListener,
  ): void {
    requireLifecycle(!state.done);
    if (event.type === "done") {
      requireLifecycle(state.started && state.stopped);
      state.done = true;
      return;
    }
    requireLifecycle(event.reasoningContent === null || event.reasoningContent === "");
    if (!state.started) {
      requireLifecycle(
        event.role === "assistant" && event.content === "" && event.finishReason === null,
      );
      state.started = true;
      state.id = event.id;
      state.created = event.created;
      return;
    }
    requireLifecycle(
      event.id === state.id && event.created === state.created && event.role === null,
    );
    if (event.finishReason !== null) {
      requireLifecycle(
        !state.stopped &&
          event.finishReason === "stop" &&
          (event.content === null || event.content === ""),
      );
      state.stopped = true;
      return;
    }
    requireLifecycle(!state.stopped);
    const delta = event.content ?? "";
    if (delta.length === 0) return;
    const candidate = state.accumulatedText + delta;
    if (Buffer.byteLength(candidate, "utf8") > MAX_WIRE_MESSAGE_BYTES) invalidResponse();
    state.accumulatedText = candidate;
    for (const update of extractor.push(delta)) onDelta?.(update);
  }

  #failValidation(failure: ProviderValidationError): never {
    try {
      this.#onValidationDiagnostic?.(providerValidationDiagnostic(failure));
    } catch {
      // Diagnostics must never replace the fixed public validation error.
    }
    throw deepSeekProviderError("INVALID_RESPONSE");
  }
}
