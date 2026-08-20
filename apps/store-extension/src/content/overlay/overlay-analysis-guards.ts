import type { AnalysisAction } from "@huayi/store-domain";

export const MAX_PREVIEW_CHARACTERS = 16_384;

export function resultMatchesAction(type: string, action: AnalysisAction): boolean {
  return action === "translate" ? type.startsWith("translate-") : type.startsWith("explain-");
}
