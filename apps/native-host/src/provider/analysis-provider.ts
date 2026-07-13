import type {
  AnalysisDeltaSection,
  AnalysisResult,
  AnalysisSectionPayload,
  AnalyzeRequest,
} from "@huayi/protocol";

export type AnalysisStreamUpdate =
  | {
      delta: string;
      section: AnalysisDeltaSection;
      type: "analysis-delta";
    }
  | (AnalysisSectionPayload & { type: "analysis-section" });

export type AnalysisStreamListener = (update: AnalysisStreamUpdate) => void;

export interface AnalysisProvider {
  analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult>;
  dispose?(): void;
}
