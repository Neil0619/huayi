import { modelUsageSchema, type AnalysisEvent, type ModelUsage } from "@huayi/cloud-contracts";

import type { AnalysisBilledCall } from "./analysis-ports.js";

export function publicAnalysisError(
  error: unknown,
  requestId: string,
): Extract<AnalysisEvent, { type: "analysis.failed" }>["error"] {
  if (error instanceof Error && "code" in error) {
    const code = error.code;
    if (
      code === "quota_exhausted" ||
      code === "generation_busy" ||
      code === "model_unavailable" ||
      code === "rate_limited"
    ) {
      return { code, message: error.message, requestId };
    }
  }
  return {
    code: "model_unavailable",
    message: "The model is temporarily unavailable.",
    requestId,
  };
}

export function modelUsageFromError(error: unknown): {
  billedCalls?: AnalysisBilledCall[];
  usage?: ModelUsage;
  usageCostMicroUsd?: number;
} {
  if (typeof error !== "object" || error === null) return {};
  const value = error as {
    billedCalls?: unknown;
    usage?: unknown;
    usageCostMicroUsd?: unknown;
  };
  const usage = modelUsageSchema.safeParse(value.usage);
  const billedCalls = billedCallsFromError(value.billedCalls);
  const cost =
    billedCalls?.reduce((total, call) => total + call.costMicroUsd, 0) ?? value.usageCostMicroUsd;
  return {
    ...(billedCalls === undefined ? {} : { billedCalls }),
    ...(typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0
      ? { usageCostMicroUsd: cost }
      : {}),
    ...(usage.success ? { usage: usage.data } : {}),
  };
}

function billedCallsFromError(value: unknown): AnalysisBilledCall[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return undefined;
  const calls: AnalysisBilledCall[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const call = raw as { costMicroUsd?: unknown; usage?: unknown };
    const usage = modelUsageSchema.safeParse(call.usage);
    if (
      !usage.success ||
      typeof call.costMicroUsd !== "number" ||
      !Number.isSafeInteger(call.costMicroUsd) ||
      call.costMicroUsd < 0
    ) {
      return undefined;
    }
    calls.push({ costMicroUsd: call.costMicroUsd, usage: usage.data });
  }
  return calls;
}

type PublicModelErrorCode = "model_output_invalid" | "model_unavailable";

export function publicModelErrorCode(error: unknown): PublicModelErrorCode {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "model_output_invalid";
  }
  if (error.code === "model_timeout" || error.code === "model_unavailable") {
    return "model_unavailable";
  }
  return "model_output_invalid";
}

export function publicModelErrorMessage(code: PublicModelErrorCode): string {
  if (code === "model_unavailable") return "The model is temporarily unavailable.";
  return "The model output was invalid.";
}
