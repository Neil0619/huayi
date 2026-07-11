import { analyzeRequestSchema, requestIdSchema } from "@huayi/protocol";
import type { AnalyzeRequest } from "@huayi/protocol";

export interface AnalyzeSelectionCommand {
  request: AnalyzeRequest;
  type: "ANALYZE_SELECTION";
}

export interface CancelAnalysisCommand {
  requestId: string;
  type: "CANCEL_ANALYSIS";
}

export type ContentCommand = AnalyzeSelectionCommand | CancelAnalysisCommand;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.sort().every((key, index) => actualKeys[index] === key)
  );
}

export function parseContentCommand(value: unknown): ContentCommand | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "ANALYZE_SELECTION" && hasExactKeys(value, ["request", "type"])) {
    const parsed = analyzeRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "ANALYZE_SELECTION" } : null;
  }

  if (value.type === "CANCEL_ANALYSIS" && hasExactKeys(value, ["requestId", "type"])) {
    const parsed = requestIdSchema.safeParse(value.requestId);
    return parsed.success ? { requestId: parsed.data, type: "CANCEL_ANALYSIS" } : null;
  }

  return null;
}
