import type { AnalysisDeltaSection, AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

export interface AnalysisStreamChunk {
  delta: string;
  section: AnalysisDeltaSection;
}

export type AnalysisStreamListener = (chunk: AnalysisStreamChunk) => void;

export interface AnalysisProvider {
  analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult>;
  dispose?(): void;
}
