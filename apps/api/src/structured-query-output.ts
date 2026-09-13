import {
  assembleSentenceExplanationResult,
  sentenceExplanationDraftSchema,
  type ExtensionQueryGenerationRequest,
} from "@huayi/cloud-contracts";
export const privateStructuredQuerySchema = sentenceExplanationDraftSchema;

export { sentenceExplanationGenerationInstructions as structuredQueryInstructions } from "@huayi/cloud-contracts";

export function assembleStructuredQueryResult(
  value: unknown,
  input: ExtensionQueryGenerationRequest,
  requestId: string,
) {
  return assembleSentenceExplanationResult(value, {
    sourceText: input.sourceText,
    selectionKind: input.selectionKind,
    requestId,
  });
}
