import { Buffer } from "node:buffer";

import { MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type { CompatibleHttpConfiguration } from "../config/compatible-http-configuration.js";
import { CompatibleHttpConfigurationError } from "../config/compatible-http-configuration-store.js";
import { CompatibleHttpCredentialError } from "../credentials/compatible-http-keychain.js";
import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";
import {
  CompatibleHttpProviderError,
  compatibleHttpProviderError,
} from "./compatible-http-provider-errors.js";
import type { CompatibleHttpResponsesClient } from "./compatible-http-responses-client.js";
import type { CompatibleHttpResponseEvent } from "./compatible-http-responses-events.js";
import { resultTypeFor, type ModelResultType } from "./model-analysis-schemas.js";
import type { ModelSchemaRepository } from "./model-schema-repository.js";
import { parseAndAssembleModelResult } from "./model-result-assembler.js";
import {
  ProviderValidationError,
  providerValidationDiagnostic,
  type ProviderValidationDiagnosticSink,
} from "./provider-validation.js";
import type { ResponsesRequest } from "./responses-request-body.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

export interface CompatibleHttpConfigurationReader {
  read(signal: AbortSignal): Promise<CompatibleHttpConfiguration>;
}

export interface CompatibleHttpKeyReader {
  read(signal: AbortSignal): Promise<string>;
}

export interface CompatibleHttpResponsesProviderOptions {
  readonly apiKeyReader: CompatibleHttpKeyReader;
  readonly client: CompatibleHttpResponsesClient;
  readonly configurationStore: CompatibleHttpConfigurationReader;
  readonly onValidationDiagnostic?: ProviderValidationDiagnosticSink;
  readonly schemaRepository: ModelSchemaRepository;
}

interface CompatibleLifecycleState {
  accumulatedBytes: number;
  accumulatedText: string;
  assistantItemId?: string;
  created: boolean;
  finalResult?: AnalysisResult;
  inProgress: boolean;
  lastSequence?: number;
  messageAdded: boolean;
  partAdded: boolean;
  rateLimitsSeen: boolean;
  reasoningAdded: boolean;
  reasoningDone: boolean;
  reasoningItemId?: string;
  responseId?: string;
  terminal: boolean;
  textDone: boolean;
}

function initialState(): CompatibleLifecycleState {
  return {
    accumulatedBytes: 0,
    accumulatedText: "",
    created: false,
    inProgress: false,
    messageAdded: false,
    partAdded: false,
    rateLimitsSeen: false,
    reasoningAdded: false,
    reasoningDone: false,
    terminal: false,
    textDone: false,
  };
}

function invalidResponse(): never {
  throw compatibleHttpProviderError("INVALID_RESPONSE");
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

function streamRequest(
  analysisRequest: AnalyzeRequest,
  configuration: CompatibleHttpConfiguration,
  outputSchema: Record<string, unknown>,
  resultType: ModelResultType,
): ResponsesRequest {
  return {
    analysisRequest,
    modelConfiguration: { effort: configuration.effort, model: configuration.model },
    outputSchema,
    outputSchemaName: resultType.replaceAll("-", "_"),
  };
}

function validateSequence(
  event: CompatibleHttpResponseEvent,
  state: CompatibleLifecycleState,
): void {
  if (event.sequence === null) {
    const openingRateLimits =
      event.type === "codex.rate_limits" &&
      !state.rateLimitsSeen &&
      !state.created &&
      state.lastSequence === undefined;
    const omittedTerminal = event.type === "response.completed";
    requireLifecycle(openingRateLimits || omittedTerminal);
    return;
  }
  if (state.lastSequence !== undefined) {
    requireLifecycle(event.sequence === state.lastSequence + 1);
  }
  state.lastSequence = event.sequence;
}

export class CompatibleHttpResponsesProvider implements AnalysisProvider {
  readonly #apiKeyReader: CompatibleHttpKeyReader;
  readonly #client: CompatibleHttpResponsesClient;
  readonly #configurationStore: CompatibleHttpConfigurationReader;
  readonly #onValidationDiagnostic: ProviderValidationDiagnosticSink | undefined;
  readonly #schemaRepository: ModelSchemaRepository;

  constructor(options: CompatibleHttpResponsesProviderOptions) {
    this.#apiKeyReader = options.apiKeyReader;
    this.#client = options.client;
    this.#configurationStore = options.configurationStore;
    this.#onValidationDiagnostic = options.onValidationDiagnostic;
    this.#schemaRepository = options.schemaRepository;
  }

  warmup(signal: AbortSignal): Promise<void> {
    return signal.aborted
      ? Promise.reject(compatibleHttpProviderError("CANCELLED"))
      : Promise.resolve();
  }

  async analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    if (signal.aborted) throw compatibleHttpProviderError("CANCELLED");
    const resultType = resultTypeForRequest(request);
    try {
      const configuration = await this.#configurationStore.read(signal);
      if (signal.aborted) throw compatibleHttpProviderError("CANCELLED");
      const key = await this.#apiKeyReader.read(signal);
      if (signal.aborted) throw compatibleHttpProviderError("CANCELLED");
      const outputSchema = await this.#schemaRepository.load(`${resultType}.json`);
      if (signal.aborted) throw compatibleHttpProviderError("CANCELLED");
      return await this.#consume(
        this.#client.stream(
          streamRequest(request, configuration, outputSchema, resultType),
          key,
          configuration.baseUrl,
          signal,
        ),
        request,
        resultType,
        signal,
        onDelta,
      );
    } catch (error) {
      if (error instanceof ProviderValidationError) this.#failValidation(error);
      if (
        error instanceof CompatibleHttpProviderError ||
        error instanceof CompatibleHttpConfigurationError ||
        error instanceof CompatibleHttpCredentialError
      ) {
        throw error;
      }
      if (signal.aborted) throw compatibleHttpProviderError("CANCELLED");
      throw compatibleHttpProviderError("INTERNAL_ERROR");
    }
  }

  async #consume(
    events: AsyncIterable<CompatibleHttpResponseEvent>,
    request: AnalyzeRequest,
    resultType: ModelResultType,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    const extractor = new StreamingJsonFieldExtractor({
      resultType,
      sentenceContext: request.sentenceContext,
    });
    const state = initialState();
    for await (const event of events) {
      if (signal.aborted) throw compatibleHttpProviderError("CANCELLED");
      requireLifecycle(!state.terminal);
      validateSequence(event, state);
      this.#consumeEvent(event, state, extractor, request, onDelta);
    }
    requireLifecycle(state.terminal);
    if (state.finalResult === undefined) return invalidResponse();
    return state.finalResult;
  }

  #consumeEvent(
    event: CompatibleHttpResponseEvent,
    state: CompatibleLifecycleState,
    extractor: StreamingJsonFieldExtractor,
    request: AnalyzeRequest,
    onDelta?: AnalysisStreamListener,
  ): void {
    switch (event.type) {
      case "codex.rate_limits":
        requireLifecycle(!state.rateLimitsSeen && !state.created);
        state.rateLimitsSeen = true;
        return;
      case "response.created":
        requireLifecycle(!state.created && !state.inProgress);
        state.created = true;
        state.responseId = event.responseId;
        return;
      case "response.in_progress":
        requireLifecycle(
          state.created && !state.inProgress && event.responseId === state.responseId,
        );
        state.inProgress = true;
        return;
      case "response.output_item.added":
        this.#consumeOutputItemAdded(event, state);
        return;
      case "response.output_item.done":
        requireLifecycle(
          state.reasoningAdded &&
            !state.reasoningDone &&
            !state.messageAdded &&
            event.itemId === state.reasoningItemId,
        );
        state.reasoningDone = true;
        return;
      case "response.content_part.added":
        requireLifecycle(
          state.messageAdded &&
            !state.partAdded &&
            event.itemId === state.assistantItemId &&
            event.text === "",
        );
        state.partAdded = true;
        return;
      case "response.output_text.delta":
        requireLifecycle(
          state.partAdded && !state.textDone && event.itemId === state.assistantItemId,
        );
        state.accumulatedBytes += Buffer.byteLength(event.delta, "utf8");
        if (state.accumulatedBytes > MAX_WIRE_MESSAGE_BYTES) invalidResponse();
        state.accumulatedText += event.delta;
        for (const update of extractor.push(event.delta)) onDelta?.(update);
        return;
      case "response.output_text.done":
        requireLifecycle(
          state.partAdded &&
            !state.textDone &&
            event.itemId === state.assistantItemId &&
            event.text === state.accumulatedText,
        );
        state.textDone = true;
        return;
      case "response.completed":
        requireLifecycle(
          state.textDone &&
            !state.terminal &&
            event.responseId === state.responseId &&
            event.itemId === state.assistantItemId &&
            event.text === state.accumulatedText,
        );
        extractor.finish();
        state.finalResult = parseAndAssembleModelResult(state.accumulatedText, request);
        state.terminal = true;
        return;
    }
  }

  #consumeOutputItemAdded(
    event: Extract<CompatibleHttpResponseEvent, { type: "response.output_item.added" }>,
    state: CompatibleLifecycleState,
  ): void {
    requireLifecycle(state.inProgress && !state.messageAdded);
    if (event.itemType === "reasoning") {
      requireLifecycle(!state.reasoningAdded && !state.reasoningDone);
      state.reasoningAdded = true;
      state.reasoningItemId = event.itemId;
      return;
    }
    requireLifecycle(!state.reasoningAdded || state.reasoningDone);
    state.messageAdded = true;
    state.assistantItemId = event.itemId;
  }

  #failValidation(failure: ProviderValidationError): never {
    try {
      this.#onValidationDiagnostic?.(providerValidationDiagnostic(failure));
    } catch {
      // Diagnostics must never replace the fixed public validation error.
    }
    throw compatibleHttpProviderError("INVALID_RESPONSE");
  }
}
