import {
  storeAnalysisReadResultSchema,
  type ExtensionQueryGenerationRequest,
} from "@huayi/cloud-contracts";
import { CloudFault } from "./cloud-fault.js";

export function validateQueryGenerationResult(
  value: unknown,
  input: ExtensionQueryGenerationRequest,
) {
  const type =
    input.selectionKind === "word"
      ? input.action === "translate"
        ? "translate-word"
        : "explain-word"
      : input.selectionKind === "phrase"
        ? input.action === "translate"
          ? "translate-lexical"
          : "explain-lexical"
        : input.action === "translate"
          ? "translate-passage"
          : "outputContract" in input
            ? "explain-sentence-v2"
            : "explain-sentence";
  const parsed = storeAnalysisReadResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.type !== type ||
    parsed.data.selectionKind !== input.selectionKind ||
    (type === "explain-sentence-v2" && parsed.data.sourceText !== input.sourceText)
  )
    throw new CloudFault(
      "model_output_invalid",
      "The model output did not match the generation contract.",
    );
  return parsed.data;
}
