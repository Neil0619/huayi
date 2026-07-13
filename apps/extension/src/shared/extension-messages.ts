import {
  addWordRequestSchema,
  analyzeRequestSchema,
  checkWordRequestSchema,
  requestIdSchema,
} from "@huayi/protocol";
import type { AddWordRequest, AnalyzeRequest, CheckWordRequest } from "@huayi/protocol";

export interface AnalyzeSelectionCommand {
  request: AnalyzeRequest;
  type: "ANALYZE_SELECTION";
}

export interface AddWordToEudicCommand {
  request: AddWordRequest;
  type: "ADD_WORD_TO_EUDIC";
}

export interface CheckWordInEudicCommand {
  request: CheckWordRequest;
  type: "CHECK_WORD_IN_EUDIC";
}

export interface CancelRequestCommand {
  requestId: string;
  type: "CANCEL_REQUEST";
}

export interface WarmupHostCommand {
  type: "WARMUP_HOST";
}

export type ContentCommand =
  | AnalyzeSelectionCommand
  | AddWordToEudicCommand
  | CheckWordInEudicCommand
  | CancelRequestCommand
  | WarmupHostCommand;

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

  if (value.type === "WARMUP_HOST" && hasExactKeys(value, ["type"])) {
    return { type: "WARMUP_HOST" };
  }

  if (value.type === "ANALYZE_SELECTION" && hasExactKeys(value, ["request", "type"])) {
    const parsed = analyzeRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "ANALYZE_SELECTION" } : null;
  }

  if (value.type === "ADD_WORD_TO_EUDIC" && hasExactKeys(value, ["request", "type"])) {
    const parsed = addWordRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "ADD_WORD_TO_EUDIC" } : null;
  }

  if (value.type === "CHECK_WORD_IN_EUDIC" && hasExactKeys(value, ["request", "type"])) {
    const parsed = checkWordRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "CHECK_WORD_IN_EUDIC" } : null;
  }

  if (value.type === "CANCEL_REQUEST" && hasExactKeys(value, ["requestId", "type"])) {
    const parsed = requestIdSchema.safeParse(value.requestId);
    return parsed.success ? { requestId: parsed.data, type: "CANCEL_REQUEST" } : null;
  }

  return null;
}
