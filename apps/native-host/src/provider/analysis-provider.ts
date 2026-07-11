import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

export interface AnalysisProvider {
  analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<AnalysisResult>;
}
