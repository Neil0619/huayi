import { calculateModelCost, type ModelPrice, type ModelUsage } from "@huayi/cloud-contracts";
import type { AnalysisBilledCall } from "./analysis-ports.js";
export type DeepSeekAnalysisModelErrorCode =
  "model_output_invalid" | "model_response_invalid" | "model_timeout" | "model_unavailable";

export class DeepSeekAnalysisModelError extends Error {
  readonly billedCalls?: readonly AnalysisBilledCall[];
  readonly code: DeepSeekAnalysisModelErrorCode;
  readonly usage?: ModelUsage;
  readonly usageCostMicroUsd?: number;

  constructor(
    code: DeepSeekAnalysisModelErrorCode,
    usageCostMicroUsd?: number,
    usage?: ModelUsage,
    billedCalls?: readonly AnalysisBilledCall[],
  ) {
    super("The platform model request failed.");
    this.name = "DeepSeekAnalysisModelError";
    this.code = code;
    if (usageCostMicroUsd !== undefined) this.usageCostMicroUsd = usageCostMicroUsd;
    if (usage !== undefined) this.usage = usage;
    if (billedCalls !== undefined) this.billedCalls = billedCalls;
  }
}

/** Retain every known usage receipt even when the stream or its one repair is invalid. */
export function billedProviderError(
  error: unknown,
  prices: ModelPrice,
  previous: readonly AnalysisBilledCall[] = [],
): unknown {
  if (!(error instanceof DeepSeekAnalysisModelError)) return error;
  const calls = [
    ...previous,
    ...(error.billedCalls ??
      (error.usage
        ? [{ usage: error.usage, costMicroUsd: calculateModelCost(error.usage, prices) }]
        : [])),
  ];
  if (calls.length === 0) return error;
  const usage = calls.reduce(
    (sum, call) => ({
      cachedInputTokens: sum.cachedInputTokens + call.usage.cachedInputTokens,
      inputTokens: sum.inputTokens + call.usage.inputTokens,
      outputTokens: sum.outputTokens + call.usage.outputTokens,
    }),
    { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 },
  );
  return new DeepSeekAnalysisModelError(
    error.code,
    calls.reduce((sum, call) => sum + call.costMicroUsd, 0),
    usage,
    calls,
  );
}
