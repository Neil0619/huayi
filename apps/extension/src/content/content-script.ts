import { SCHEMA_VERSION, analyzeRequestSchema } from "@huayi/protocol";
import type { AnalyzeAction, AnalyzeRequest } from "@huayi/protocol";

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
    targetLanguage: "zh-CN",
    type: "analyze",
  });
}
