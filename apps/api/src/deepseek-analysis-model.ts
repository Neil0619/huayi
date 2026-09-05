import { billedProviderError } from "./deepseek-provider-error.js";
import { modelDeadline } from "./model-execution.js";
import { createTextModelPreview } from "./text-model-preview.js";
import {
  calculateModelCost,
  analysisContentSchema,
  candidateSchema,
  modelPriceSchema,
  modelUsageSchema,
  normalizeWhitespaceAndQuotes,
  webDeepAnalysisSchema,
  type ModelPrice,
  type ModelUsage,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";
import { z } from "zod/v3";

import type { AnalysisModel, SegmentedSentence } from "./analysis-ports.js";
import {
  buildDeepSeekAnalysisRequest,
  DEEPSEEK_PLATFORM_ENDPOINT,
  DEEPSEEK_PLATFORM_MODEL,
  deepSeekOutputLimit,
  DeepSeekAnalysisModelError,
  parseDeepSeekAnalysisResponse,
  type DeepSeekAnalysisFetch,
  type DeepSeekAnalysisFetchInit,
  type DeepSeekAnalysisFetchResponse,
  type DeepSeekAnalysisModelErrorCode,
  type DeepSeekProviderCallResult,
} from "./deepseek-analysis-protocol.js";

export { DEEPSEEK_PLATFORM_ENDPOINT, DEEPSEEK_PLATFORM_MODEL, DeepSeekAnalysisModelError };
export type {
  DeepSeekAnalysisFetch,
  DeepSeekAnalysisFetchInit,
  DeepSeekAnalysisFetchResponse,
  DeepSeekAnalysisModelErrorCode,
};

const PROMPT_VERSION = "web-deep-analysis-v2.2";
const SCHEMA_VERSION = 2;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAXIMUM_TIMEOUT_MS = 90_000;

const privateAnalysisOutputSchema = z.strictObject({
  previewZh: z.string().trim().min(1).max(1000).optional(),
  candidates: z.array(candidateSchema).max(200),
  result: webDeepAnalysisSchema,
});

interface DeepSeekAnalysisModelOptions {
  apiKey: string;
  fetch?: DeepSeekAnalysisFetch;
  prices: ModelPrice | (() => Promise<ModelPrice>);
  timeoutMs?: number;
}

function defaultFetch(
  url: string,
  init: DeepSeekAnalysisFetchInit,
): Promise<DeepSeekAnalysisFetchResponse> {
  return fetch(url, init);
}

export function deepSeekMaximumUsage(input: StartAnalysisRequest): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: 65_536,
    outputTokens: deepSeekOutputLimit(input) * 2,
  };
}

async function resolvePrices(options: DeepSeekAnalysisModelOptions): Promise<ModelPrice> {
  return modelPriceSchema.parse(
    typeof options.prices === "function" ? await options.prices() : options.prices,
  );
}

function addUsage(first: ModelUsage, second: ModelUsage): ModelUsage {
  return modelUsageSchema.parse({
    cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
  });
}

function trustedContent(
  rawContent: string,
  input: StartAnalysisRequest,
  sentences: readonly SegmentedSentence[],
  usage: ModelUsage,
): unknown {
  let json: unknown;
  try {
    json = JSON.parse(rawContent);
  } catch {
    return null;
  }
  const parsed = privateAnalysisOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  const parsedResult = parsed.data.result;
  let result: unknown = parsedResult;
  if ("sentences" in parsedResult) {
    if (parsedResult.sentences.length !== sentences.length) return null;
    result = {
      ...parsedResult,
      sentences: parsedResult.sentences.map((sentence, index) => ({
        ...sentence,
        ...sentences[index],
      })),
    };
  }
  const content = analysisContentSchema.safeParse({
    candidates: parsed.data.candidates,
    modelMetadata: {
      inputTokens: usage.inputTokens,
      model: DEEPSEEK_PLATFORM_MODEL,
      outputTokens: usage.outputTokens,
      promptVersion: PROMPT_VERSION,
      provider: "deepseek",
      schemaVersion: SCHEMA_VERSION,
    },
    result,
    selectionKind: input.selectionKind,
    source: input.source,
    sourceNormalizedHash: createHash("sha256")
      .update(normalizeWhitespaceAndQuotes(input.sourceText))
      .digest("hex"),
    sourceText: input.sourceText,
  });
  return content.success ? content.data : null;
}

export function createDeepSeekAnalysisModel(options: DeepSeekAnalysisModelOptions): AnalysisModel {
  if (options.apiKey.trim() === "") throw new DeepSeekAnalysisModelError("model_unavailable");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAXIMUM_TIMEOUT_MS) {
    throw new DeepSeekAnalysisModelError("model_unavailable");
  }
  const providerFetch = options.fetch ?? defaultFetch;

  return {
    async analyze(command) {
      const controller = modelDeadline(timeoutMs, command.signal);
      let firstToken = false;
      const preview = createTextModelPreview(new Set(["previewZh"]), command);
      const prices = await resolvePrices(options);
      const call = async (repairContent?: string): Promise<DeepSeekProviderCallResult> => {
        try {
          await command.beforeDispatch?.();
          controller.signal.throwIfAborted();
        } catch {
          throw new DeepSeekAnalysisModelError("model_unavailable", 0);
        }
        let response: DeepSeekAnalysisFetchResponse;
        try {
          response = await providerFetch(DEEPSEEK_PLATFORM_ENDPOINT, {
            body: buildDeepSeekAnalysisRequest(command.input, command.sentences, repairContent),
            credentials: "omit",
            headers: {
              Accept: "text/event-stream, application/json",
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            redirect: "error",
            signal: controller.signal,
          });
        } catch {
          throw new DeepSeekAnalysisModelError(
            controller.signal.aborted ? "model_timeout" : "model_unavailable",
          );
        }
        if (controller.signal.aborted) throw new DeepSeekAnalysisModelError("model_timeout");
        if (response.status !== 200) {
          try {
            await response.body?.cancel();
          } catch {
            // Provider error bodies are intentionally discarded.
          }
          throw new DeepSeekAnalysisModelError("model_unavailable");
        }
        if (
          !["application/json", "text/event-stream"].includes(
            response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "",
          )
        ) {
          throw new DeepSeekAnalysisModelError("model_response_invalid");
        }
        const result = await parseDeepSeekAnalysisResponse(
          response,
          controller.signal,
          (text) => {
            if (repairContent === undefined) preview(text);
          },
          () => {
            if (!firstToken) {
              firstToken = true;
              command.onTiming?.("provider-first-token");
            }
          },
        ).catch((error: unknown) => {
          throw billedProviderError(error, prices);
        });
        command.onTiming?.(repairContent === undefined ? "generation-complete" : "repair-complete");
        return result;
      };

      try {
        const first = await call();
        const firstContent = trustedContent(
          first.content,
          command.input,
          command.sentences,
          first.usage,
        );
        if (firstContent !== null) {
          const costMicroUsd = calculateModelCost(first.usage, prices);
          return {
            billedCalls: [{ costMicroUsd, usage: first.usage }],
            content: firstContent,
            usage: first.usage,
            usageCostMicroUsd: costMicroUsd,
          };
        }
        const firstBilledCall = {
          costMicroUsd: calculateModelCost(first.usage, prices),
          usage: first.usage,
        };
        let second: DeepSeekProviderCallResult;
        try {
          command.onTiming?.("repair-start");
          second = await call(first.content);
        } catch (error) {
          throw billedProviderError(error, prices, [firstBilledCall]);
        }
        const usage = addUsage(first.usage, second.usage);
        const billedCalls = [first, second].map((providerCall) => ({
          costMicroUsd: calculateModelCost(providerCall.usage, prices),
          usage: providerCall.usage,
        }));
        const usageCostMicroUsd = billedCalls.reduce((total, item) => total + item.costMicroUsd, 0);
        const repairedContent = trustedContent(
          second.content,
          command.input,
          command.sentences,
          usage,
        );
        if (repairedContent === null) {
          throw new DeepSeekAnalysisModelError(
            "model_output_invalid",
            usageCostMicroUsd,
            usage,
            billedCalls,
          );
        }
        return {
          billedCalls,
          content: repairedContent,
          usage,
          usageCostMicroUsd,
        };
      } finally {
        controller.dispose();
      }
    },
  };
}
