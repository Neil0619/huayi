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

const PROMPT_VERSION = "web-deep-analysis-v2";
const SCHEMA_VERSION = 2;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAXIMUM_TIMEOUT_MS = 90_000;

const privateAnalysisOutputSchema = z.strictObject({
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
  let result: unknown;
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const call = async (repairContent?: string): Promise<DeepSeekProviderCallResult> => {
        let response: DeepSeekAnalysisFetchResponse;
        try {
          response = await providerFetch(DEEPSEEK_PLATFORM_ENDPOINT, {
            body: buildDeepSeekAnalysisRequest(command.input, command.sentences, repairContent),
            credentials: "omit",
            headers: {
              Accept: "application/json",
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
          response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
        ) {
          throw new DeepSeekAnalysisModelError("model_response_invalid");
        }
        return parseDeepSeekAnalysisResponse(response, controller.signal);
      };

      try {
        const prices = await resolvePrices(options);
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
            preview: "正在分析。",
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
          second = await call(first.content);
        } catch (error) {
          if (error instanceof DeepSeekAnalysisModelError) {
            throw new DeepSeekAnalysisModelError(
              error.code,
              firstBilledCall.costMicroUsd,
              first.usage,
              [firstBilledCall],
            );
          }
          throw error;
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
          preview: "正在分析。",
          usage,
          usageCostMicroUsd,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
