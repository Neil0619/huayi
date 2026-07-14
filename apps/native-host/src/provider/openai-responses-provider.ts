import { Buffer } from "node:buffer";

import { MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import { OpenAICredentialError, type OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";
import { resultTypeFor, type ModelResultType } from "./model-analysis-schemas.js";
import type { ModelSchemaRepository } from "./model-schema-repository.js";
import { parseAndAssembleModelResult } from "./model-result-assembler.js";
import type { OpenAIResponseEvent } from "./openai-responses-events.js";
import type {
  OpenAIModelConfiguration,
  OpenAIResponsesClient,
  OpenAIResponsesRequest,
} from "./openai-responses-client.js";
import { OpenAIProviderError, openAIProviderError } from "./openai-provider-errors.js";
import {
  ProviderValidationError,
  providerValidationDiagnostic,
  type ProviderValidationDiagnosticSink,
} from "./provider-validation.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

const DEFAULT_MODEL_CONFIGURATION = {
  effort: "none",
  model: "gpt-5.6-luna",
} as const satisfies OpenAIModelConfiguration;

export interface OpenAIResponsesProviderOptions {
  apiKeyReader: OpenAIApiKeyReader;
  client: OpenAIResponsesClient;
  modelConfiguration?: Readonly<OpenAIModelConfiguration>;
  onValidationDiagnostic?: ProviderValidationDiagnosticSink;
  schemaRepository: ModelSchemaRepository;
}

interface LifecycleState {
  accumulatedText: string;
  created: boolean;
  finalResult?: AnalysisResult;
  inProgress: boolean;
  itemId?: string;
  outputAdded: boolean;
  outputDone: boolean;
  partAdded: boolean;
  partDone: boolean;
  responseId?: string;
  terminal: boolean;
  textDone: boolean;
}

function initialState(): LifecycleState {
  return {
    accumulatedText: "",
    created: false,
    inProgress: false,
    outputAdded: false,
    outputDone: false,
    partAdded: false,
    partDone: false,
    terminal: false,
    textDone: false,
  };
}

function invalidResponse(): never {
  throw openAIProviderError("INVALID_RESPONSE");
}

function requireLifecycle(condition: boolean): void {
  if (!condition) invalidResponse();
}

function resultTypeForRequest(request: AnalyzeRequest): ModelResultType {
  try {
    return resultTypeFor(request);
  } catch (cause) {
    throw openAIProviderError("INVALID_RESPONSE", cause);
  }
}

function streamRequest(
  analysisRequest: AnalyzeRequest,
  modelConfiguration: Readonly<OpenAIModelConfiguration>,
  outputSchema: Record<string, unknown>,
  resultType: ModelResultType,
): OpenAIResponsesRequest {
  return {
    analysisRequest,
    modelConfiguration,
    outputSchema,
    outputSchemaName: resultType.replaceAll("-", "_"),
  };
}

export class OpenAIResponsesProvider implements AnalysisProvider {
  readonly #apiKeyReader: OpenAIApiKeyReader;
  readonly #client: OpenAIResponsesClient;
  readonly #modelConfiguration: Readonly<OpenAIModelConfiguration>;
  readonly #onValidationDiagnostic: ProviderValidationDiagnosticSink | undefined;
  readonly #schemaRepository: ModelSchemaRepository;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.#apiKeyReader = options.apiKeyReader;
    this.#client = options.client;
    this.#modelConfiguration = options.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION;
    this.#onValidationDiagnostic = options.onValidationDiagnostic;
    this.#schemaRepository = options.schemaRepository;
  }

  warmup(signal: AbortSignal): Promise<void> {
    return signal.aborted ? Promise.reject(openAIProviderError("CANCELLED")) : Promise.resolve();
  }

  async analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    if (signal.aborted) throw openAIProviderError("CANCELLED");
    const resultType = resultTypeForRequest(request);
    try {
      const key = await this.#apiKeyReader.read(signal);
      if (signal.aborted) throw openAIProviderError("CANCELLED");
      const outputSchema = await this.#schemaRepository.load(`${resultType}.json`);
      if (signal.aborted) throw openAIProviderError("CANCELLED");
      return await this.#consume(
        this.#client.stream(
          streamRequest(request, this.#modelConfiguration, outputSchema, resultType),
          key,
          signal,
        ),
        request,
        resultType,
        onDelta,
      );
    } catch (error) {
      if (error instanceof ProviderValidationError) this.#failValidation(error);
      if (error instanceof OpenAIProviderError || error instanceof OpenAICredentialError) {
        throw error;
      }
      throw openAIProviderError("INTERNAL_ERROR", error);
    }
  }

  async #consume(
    events: AsyncIterable<OpenAIResponseEvent>,
    request: AnalyzeRequest,
    resultType: ModelResultType,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    const extractor = new StreamingJsonFieldExtractor({
      resultType,
      sentenceContext: request.sentenceContext,
    });
    const state = initialState();

    for await (const event of events) {
      requireLifecycle(!state.terminal);
      this.#consumeEvent(event, state, extractor, request, onDelta);
    }
    requireLifecycle(state.terminal);
    if (state.finalResult === undefined) return invalidResponse();
    return state.finalResult;
  }

  #consumeEvent(
    event: OpenAIResponseEvent,
    state: LifecycleState,
    extractor: StreamingJsonFieldExtractor,
    request: AnalyzeRequest,
    onDelta?: AnalysisStreamListener,
  ): void {
    switch (event.type) {
      case "response.created":
        requireLifecycle(!state.created && !state.inProgress && event.status === "in_progress");
        state.created = true;
        state.responseId = event.responseId;
        return;
      case "response.in_progress":
        requireLifecycle(
          state.created &&
            !state.inProgress &&
            event.responseId === state.responseId &&
            event.status === "in_progress",
        );
        state.inProgress = true;
        return;
      case "response.output_item.added":
        requireLifecycle(state.inProgress && !state.outputAdded);
        state.outputAdded = true;
        state.itemId = event.itemId;
        return;
      case "response.content_part.added":
        requireLifecycle(
          state.outputAdded &&
            !state.partAdded &&
            event.itemId === state.itemId &&
            event.text === "",
        );
        state.partAdded = true;
        return;
      case "response.output_text.delta": {
        requireLifecycle(state.partAdded && !state.textDone && event.itemId === state.itemId);
        const candidate = state.accumulatedText + event.delta;
        if (Buffer.byteLength(candidate, "utf8") > MAX_WIRE_MESSAGE_BYTES) invalidResponse();
        state.accumulatedText = candidate;
        for (const update of extractor.push(event.delta)) onDelta?.(update);
        return;
      }
      case "response.output_text.done":
        requireLifecycle(
          state.partAdded &&
            !state.textDone &&
            event.itemId === state.itemId &&
            event.text === state.accumulatedText,
        );
        state.textDone = true;
        return;
      case "response.content_part.done":
        requireLifecycle(
          state.textDone &&
            !state.partDone &&
            event.itemId === state.itemId &&
            event.text === state.accumulatedText,
        );
        state.partDone = true;
        return;
      case "response.output_item.done":
        requireLifecycle(
          state.partDone &&
            !state.outputDone &&
            event.itemId === state.itemId &&
            event.text === state.accumulatedText,
        );
        state.outputDone = true;
        return;
      case "response.completed":
        requireLifecycle(
          state.outputDone &&
            event.responseId === state.responseId &&
            event.itemId === state.itemId &&
            event.status === "completed" &&
            event.text === state.accumulatedText,
        );
        extractor.finish();
        state.finalResult = parseAndAssembleModelResult(state.accumulatedText, request);
        state.terminal = true;
        return;
      case "response.failed":
      case "response.incomplete":
        requireLifecycle(event.responseId === state.responseId);
        return invalidResponse();
      case "error":
        return invalidResponse();
    }
  }

  #failValidation(failure: ProviderValidationError): never {
    try {
      this.#onValidationDiagnostic?.(providerValidationDiagnostic(failure));
    } catch {
      // Diagnostics must never replace the fixed public validation error.
    }
    throw openAIProviderError("INVALID_RESPONSE", failure);
  }
}
