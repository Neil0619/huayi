import {
  SCHEMA_VERSION,
  addWordRequestSchema,
  analyzeRequestSchema,
  checkWordRequestSchema,
} from "@huayi/protocol";
import type {
  AddWordRequest,
  AnalyzeAction,
  AnalyzeRequest,
  CheckWordRequest,
} from "@huayi/protocol";

import type { SelectionRequestInput } from "./selection/read-selection.js";

export function createAnalyzeRequest(
  selection: SelectionRequestInput,
  action: AnalyzeAction,
  requestId: string,
): AnalyzeRequest {
  return analyzeRequestSchema.parse({
    action,
    context: selection.context,
    requestId,
    schemaVersion: SCHEMA_VERSION,
    selection: selection.selection,
    selectionKind: selection.selectionKind,
    sentenceContext: selection.sentenceContext,
    targetLanguage: "zh-CN",
    type: "analyze",
  });
}

export function createAddWordRequest(
  selection: SelectionRequestInput,
  requestId: string,
): AddWordRequest {
  return addWordRequestSchema.parse({
    context: selection.wordbookContext,
    language: "en",
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "add-word",
    word: selection.selection,
  });
}

export function createCheckWordRequest(
  selection: SelectionRequestInput,
  requestId: string,
): CheckWordRequest {
  return checkWordRequestSchema.parse({
    language: "en",
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "check-word",
    word: selection.selection,
  });
}
