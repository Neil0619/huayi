import {
  analysisRequestSchema,
  analysisResultSchema,
  type AnalysisCancellationSignal,
  type AnalysisEngine,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalysisUpdateListener,
  type CredentialSlot,
  type DeviceVault,
} from "@huayi/store-domain";

import { BrowserAnalysisError } from "./analysis-error.js";
import {
  readProviderSse,
  type ProviderFetch,
  type ProviderStreamLimits,
} from "./bounded-provider-stream.js";
import { IncrementalJsonPreview } from "./json-preview.js";
import {
  assemblePublicResult,
  parseModelResult,
  resultTypeFor,
  type ModelResultType,
} from "./model-contracts.js";
import { parseDeepSeekEvent, parseOpenAiEvent } from "./provider-events.js";
import { parseProviderJson } from "./provider-json.js";
import {
  buildDeepSeekRequestBody,
  buildOpenAIRequestBody,
  DEEPSEEK_CHAT_ENDPOINT,
  OPENAI_RESPONSES_ENDPOINT,
} from "./provider-requests.js";
import type { SseMessage } from "./sse-decoder.js";

export interface BrowserAnalysisEngineOptions {
  readonly deviceVault: DeviceVault;
  readonly fetch?: ProviderFetch;
  readonly streamLimits?: Partial<ProviderStreamLimits>;
}

function productionFetch(
  endpoint: string,
  init: Parameters<ProviderFetch>[1],
): ReturnType<ProviderFetch> {
  return fetch(endpoint, init);
}

function require(condition: boolean): void {
  if (!condition) throw new BrowserAnalysisError("invalid-response");
}

function emitPreview(
  preview: IncrementalJsonPreview,
  text: string,
  requestId: string,
  sequence: { value: number },
  onUpdate: AnalysisUpdateListener,
): void {
  for (const delta of preview.push(text)) {
    onUpdate({
      ...delta,
      requestId,
      sequence: sequence.value,
    });
    sequence.value += 1;
  }
}

async function consumeOpenAi(
  messages: AsyncIterable<SseMessage>,
  request: AnalysisRequest,
  type: ModelResultType,
  onUpdate: AnalysisUpdateListener,
): Promise<string> {
  const state: {
    accumulated: string;
    created: boolean;
    inProgress: boolean;
    itemAdded: boolean;
    itemId?: string;
    partAdded: boolean;
    responseId?: string;
    terminal: boolean;
    textDone: boolean;
    partDone: boolean;
    itemDone: boolean;
  } = {
    accumulated: "",
    created: false,
    inProgress: false,
    itemAdded: false,
    partAdded: false,
    terminal: false,
    textDone: false,
    partDone: false,
    itemDone: false,
  };
  const preview = new IncrementalJsonPreview(type, request.sentenceContext);
  const sequence = { value: 0 };
  let providerSequence = 0;
  for await (const message of messages) {
    require(!state.terminal);
    const event = parseOpenAiEvent(message);
    require(event.sequence === providerSequence);
    providerSequence += 1;
    switch (event.type) {
      case "created":
        require(!state.created);
        state.created = true;
        state.responseId = event.responseId;
        break;
      case "in-progress":
        require(state.created && !state.inProgress && event.responseId === state.responseId);
        state.inProgress = true;
        break;
      case "item-added":
        require(state.inProgress && !state.itemAdded);
        state.itemAdded = true;
        state.itemId = event.itemId;
        break;
      case "part-added":
        require(
          state.itemAdded && !state.partAdded && event.itemId === state.itemId && event.text === "",
        );
        state.partAdded = true;
        break;
      case "text-delta":
        require(state.partAdded && !state.textDone && event.itemId === state.itemId);
        state.accumulated += event.text;
        emitPreview(preview, event.text, request.requestId, sequence, onUpdate);
        break;
      case "text-done":
        require(
          !state.textDone && event.itemId === state.itemId && event.text === state.accumulated,
        );
        state.textDone = true;
        break;
      case "part-done":
        require(
          state.textDone &&
            !state.partDone &&
            event.itemId === state.itemId &&
            event.text === state.accumulated,
        );
        state.partDone = true;
        break;
      case "item-done":
        require(
          state.partDone &&
            !state.itemDone &&
            event.itemId === state.itemId &&
            event.text === state.accumulated,
        );
        state.itemDone = true;
        break;
      case "completed":
        require(
          state.itemDone &&
            event.responseId === state.responseId &&
            event.itemId === state.itemId &&
            event.text === state.accumulated,
        );
        state.terminal = true;
        break;
    }
  }
  require(state.terminal);
  return preview.finish();
}

async function consumeDeepSeek(
  messages: AsyncIterable<SseMessage>,
  request: AnalysisRequest,
  type: ModelResultType,
  onUpdate: AnalysisUpdateListener,
): Promise<string> {
  const state: {
    accumulated: string;
    created?: number;
    done: boolean;
    id?: string;
    started: boolean;
    stopped: boolean;
  } = { accumulated: "", done: false, started: false, stopped: false };
  const preview = new IncrementalJsonPreview(type, request.sentenceContext);
  const sequence = { value: 0 };
  for await (const message of messages) {
    require(!state.done);
    const event = parseDeepSeekEvent(message);
    if (event.type === "done") {
      require(state.started && state.stopped);
      state.done = true;
      continue;
    }
    require(event.reasoning === null || event.reasoning === "");
    if (!state.started) {
      require(event.role === "assistant" && event.content === "" && event.finishReason === null);
      state.started = true;
      state.id = event.id;
      state.created = event.created;
      continue;
    }
    require(event.id === state.id && event.created === state.created && event.role === null);
    if (event.finishReason !== null) {
      require(
        !state.stopped &&
          event.finishReason === "stop" &&
          (event.content === null || event.content === ""),
      );
      state.stopped = true;
      continue;
    }
    require(!state.stopped);
    const delta = event.content ?? "";
    if (delta.length > 0) {
      state.accumulated += delta;
      emitPreview(preview, delta, request.requestId, sequence, onUpdate);
    }
  }
  require(state.started && state.stopped && state.done && state.accumulated.length > 0);
  return preview.finish();
}

export class BrowserAnalysisEngine implements AnalysisEngine {
  private readonly deviceVault: DeviceVault;
  private readonly providerFetch: ProviderFetch;
  private readonly streamLimits: Partial<ProviderStreamLimits> | undefined;

  constructor(options: BrowserAnalysisEngineOptions) {
    this.deviceVault = options.deviceVault;
    this.providerFetch = options.fetch ?? productionFetch;
    this.streamLimits = options.streamLimits;
  }

  async analyze(
    requestValue: AnalysisRequest,
    signal: AnalysisCancellationSignal,
    onUpdate: AnalysisUpdateListener,
  ): Promise<AnalysisResult> {
    let request: AnalysisRequest;
    try {
      request = analysisRequestSchema.parse(requestValue);
      signal.throwIfAborted();
    } catch {
      if (signal.aborted) throw new BrowserAnalysisError("cancelled");
      throw new BrowserAnalysisError("invalid-response");
    }
    onUpdate({ requestId: request.requestId, stage: "queued", type: "progress" });
    const slot: CredentialSlot =
      request.providerId === "openai" ? "openai-api-key" : "deepseek-api-key";
    let key: string | null;
    try {
      key = await this.deviceVault.getCredential(slot);
    } catch {
      if (signal.aborted) throw new BrowserAnalysisError("cancelled");
      throw new BrowserAnalysisError("internal-error");
    }
    if (signal.aborted) throw new BrowserAnalysisError("cancelled");
    if (key === null || key.trim().length === 0) {
      throw new BrowserAnalysisError("credential-missing");
    }
    onUpdate({ requestId: request.requestId, stage: "running", type: "progress" });
    const type = resultTypeFor(request);
    const isOpenAi = request.providerId === "openai";
    const messages = readProviderSse({
      body: isOpenAi
        ? buildOpenAIRequestBody(request, type)
        : buildDeepSeekRequestBody(request, type),
      endpoint: isOpenAi ? OPENAI_RESPONSES_ENDPOINT : DEEPSEEK_CHAT_ENDPOINT,
      fetch: this.providerFetch,
      key,
      ...(this.streamLimits === undefined ? {} : { limits: this.streamLimits }),
      signal,
    });
    try {
      const text = isOpenAi
        ? await consumeOpenAi(messages, request, type, onUpdate)
        : await consumeDeepSeek(messages, request, type, onUpdate);
      const model = parseModelResult(type, parseProviderJson(text));
      return analysisResultSchema.parse(assemblePublicResult(request, type, model));
    } catch (error) {
      if (error instanceof BrowserAnalysisError) throw error;
      if (signal.aborted) throw new BrowserAnalysisError("cancelled");
      throw new BrowserAnalysisError("invalid-response");
    }
  }
}

export function createBrowserAnalysisEngine(options: BrowserAnalysisEngineOptions): AnalysisEngine {
  return new BrowserAnalysisEngine(options);
}
