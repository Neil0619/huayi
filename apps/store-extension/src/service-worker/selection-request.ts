import {
  analysisRequestSchema,
  classifyEnglishSelection,
  type AnalysisRequest,
} from "@huayi/store-domain";

import type { StoreAnalysisStartMessage, StoreSettings } from "@huayi/store-domain";

export function createTrustedAnalysisRequest(
  message: StoreAnalysisStartMessage,
  settings: StoreSettings,
  requestId: string,
): AnalysisRequest {
  const selectionKind = classifyEnglishSelection(message.selection, message.boundaryEvidence);
  if (selectionKind === null) throw new TypeError("Unsupported selection.");
  return analysisRequestSchema.parse({
    action: message.action,
    providerId: settings.providerId,
    requestId,
    selection: message.selection,
    selectionKind,
    sentenceContext: selectionKind === "sentence" ? null : message.sentenceContext,
    targetLanguage: "zh-CN",
  });
}
