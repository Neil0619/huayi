import { setDiagnosticContext } from "./diagnostic-context.js";
import { billedProviderError } from "./deepseek-provider-error.js";
import type { AnalysisRepairFeedback } from "./deepseek-analysis-diagnostics.js";
import { trustedDeepSeekAnalysisContent } from "./deepseek-analysis-private-output.js";
import { hasCompleteAnalysisSource } from "./analysis-segmentation.js";
import { modelDeadline } from "./model-execution.js";
import { createTextModelPreview } from "./text-model-preview.js";
import {
  calculateModelCost,
  modelPriceSchema,
  modelUsageSchema,
  type ModelPrice,
  type ModelUsage,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";

import type { AnalysisModel } from "./analysis-ports.js";
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

const DEFAULT_TIMEOUT_MS = 90_000;
const MAXIMUM_TIMEOUT_MS = 90_000;

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

export function createDeepSeekAnalysisModel(options: DeepSeekAnalysisModelOptions): AnalysisModel {
  if (options.apiKey.trim() === "") throw new DeepSeekAnalysisModelError("model_unavailable");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAXIMUM_TIMEOUT_MS) {
    throw new DeepSeekAnalysisModelError("model_unavailable");
  }
  const providerFetch = options.fetch ?? defaultFetch;

  return {
    async analyze(command) {
      setDiagnosticContext({ operation: "analysis" });
      if (!hasCompleteAnalysisSource(command.input, command.sentences)) {
        throw new DeepSeekAnalysisModelError("model_output_invalid", 0);
      }
      const firstBody = buildDeepSeekAnalysisRequest(command.input, command.sentences);
      const prices = await resolvePrices(options);
      const controller = modelDeadline(timeoutMs, command.signal);
      let firstToken = false;
      const preview = createTextModelPreview(new Set(["previewZh"]), command);
      const call = async (
        repairContent?: string,
        feedback?: AnalysisRepairFeedback,
      ): Promise<DeepSeekProviderCallResult> => {
        const body =
          repairContent === undefined
            ? firstBody
            : buildDeepSeekAnalysisRequest(
                command.input,
                command.sentences,
                repairContent,
                feedback,
              );
        try {
          await command.beforeDispatch?.();
          controller.signal.throwIfAborted();
        } catch {
          throw new DeepSeekAnalysisModelError("model_unavailable", 0);
        }
        let response: DeepSeekAnalysisFetchResponse;
        try {
          response = await providerFetch(DEEPSEEK_PLATFORM_ENDPOINT, {
            body,
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
        const firstContent = trustedDeepSeekAnalysisContent(
          first.content,
          command.input,
          command.sentences,
          first.usage,
          "first",
        );
        if (firstContent.feedback === undefined) {
          const costMicroUsd = calculateModelCost(first.usage, prices);
          return {
            billedCalls: [{ costMicroUsd, usage: first.usage }],
            content: firstContent.content,
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
          second = await call(first.content, firstContent.feedback);
        } catch (error) {
          throw billedProviderError(error, prices, [firstBilledCall]);
        }
        const usage = addUsage(first.usage, second.usage);
        const billedCalls = [first, second].map((providerCall) => ({
          costMicroUsd: calculateModelCost(providerCall.usage, prices),
          usage: providerCall.usage,
        }));
        const usageCostMicroUsd = billedCalls.reduce((total, item) => total + item.costMicroUsd, 0);
        const repairedContent = trustedDeepSeekAnalysisContent(
          second.content,
          command.input,
          command.sentences,
          usage,
          "repair",
        );
        if (repairedContent.feedback !== undefined) {
          throw new DeepSeekAnalysisModelError(
            "model_output_invalid",
            usageCostMicroUsd,
            usage,
            billedCalls,
          );
        }
        return {
          billedCalls,
          content: repairedContent.content,
          usage,
          usageCostMicroUsd,
        };
      } finally {
        controller.dispose();
      }
    },
  };
}
