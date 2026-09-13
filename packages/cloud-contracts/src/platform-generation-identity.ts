import type { ExtensionQueryGenerationRequest } from "./structured-teaching-requests.js";

export const PLATFORM_DEEPSEEK_MODEL = "deepseek-flash";
export const PLATFORM_ANALYSIS_PROMPT_VERSION = "web-deep-analysis-v2.11-balanced";
export const PLATFORM_STRUCTURED_ANALYSIS_PROMPT_VERSION = "web-deep-analysis-v3.0-structured";

// Shared release identity for client caches. Bump the effective prompt version when the
// server's instructions, examples, repair policy or output schema change.
export function platformAnalysisGenerationIdentity(structured: boolean) {
  return {
    provider: "deepseek",
    model: PLATFORM_DEEPSEEK_MODEL,
    promptVersion: structured
      ? PLATFORM_STRUCTURED_ANALYSIS_PROMPT_VERSION
      : PLATFORM_ANALYSIS_PROMPT_VERSION,
    schemaVersion: structured ? 3 : 2,
    resultType: structured ? "analysis-v3" : "analysis-v2",
    outputContract: structured ? "structured-teaching-v1" : "legacy",
  } as const;
}

export function platformQueryGenerationIdentity(
  input: Pick<ExtensionQueryGenerationRequest, "action" | "selectionKind"> & {
    outputContract?: "structured-teaching-v1";
  },
) {
  const structured =
    input.outputContract === "structured-teaching-v1" &&
    input.action === "explain" &&
    (input.selectionKind === "sentence" || input.selectionKind === "passage");
  const resultType =
    input.selectionKind === "word"
      ? `${input.action}-word`
      : input.selectionKind === "phrase"
        ? `${input.action}-lexical`
        : input.action === "translate"
          ? "translate-passage"
          : structured
            ? "explain-sentence-v2"
            : "explain-sentence";
  return {
    provider: "deepseek",
    model: PLATFORM_DEEPSEEK_MODEL,
    promptVersion: structured ? "platform-query-v2-structured" : "platform-query-v1",
    schemaVersion: structured ? 2 : 1,
    resultType,
    outputContract: input.outputContract ?? "legacy",
  } as const;
}
