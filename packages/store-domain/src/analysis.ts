import { z } from "zod/v3";

import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";
import { analysisResultSchema, type AnalysisResult } from "./analysis-results.js";
import { type AnalysisUpdate } from "@huayi/learning-domain";
export { analysisUpdateSchema, type AnalysisUpdate } from "@huayi/learning-domain";

export const providerIdSchema = z.enum(["openai", "deepseek"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const analysisActionSchema = z.enum(["translate", "explain"]);
export type AnalysisAction = z.infer<typeof analysisActionSchema>;

export const selectionKindSchema = z.enum(["word", "phrase", "sentence", "passage"]);
export type SelectionKind = z.infer<typeof selectionKindSchema>;

const requestIdSchema = z.string().trim().min(1).max(64);
const sourceTextSchema = z.string().trim().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH);

export const analysisRequestSchema = z.strictObject({
  action: analysisActionSchema,
  providerId: providerIdSchema,
  requestId: requestIdSchema,
  selection: sourceTextSchema,
  selectionKind: selectionKindSchema,
  sentenceContext: z.string().max(MAX_CONTEXT_SENTENCE_LENGTH).nullable(),
  targetLanguage: z.literal("zh-CN"),
});
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export { analysisResultSchema };
export type { AnalysisResult };

export interface AnalysisCancellationSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

export type AnalysisUpdateListener = (update: AnalysisUpdate) => void;

export interface AnalysisEngine {
  analyze(
    request: AnalysisRequest,
    signal: AnalysisCancellationSignal,
    onUpdate: AnalysisUpdateListener,
  ): Promise<AnalysisResult>;
}
