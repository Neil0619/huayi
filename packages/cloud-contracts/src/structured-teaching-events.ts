import { z } from "zod/v3";
import {
  analysisRecordReadSchema,
  storeAnalysisReadResultSchema,
  structuredSentenceUnitSchema,
  projectAnalysisRecordForLegacy,
  projectStoreResultForLegacy,
  projectStructuredSentencePreview,
} from "@huayi/learning-domain";
import {
  analysisEventSchema,
  analysisHistoryResponseSchema,
  type AnalysisEvent,
} from "./analysis-contracts.js";
import {
  extensionQueryEventSchema,
  extensionQueryGenerationSchema,
  type ExtensionQueryEvent,
  type ExtensionQueryGeneration,
} from "./extension-learning-contracts.js";
import { resourceIdSchema } from "./common-contracts.js";
import { confirmCandidatesResponseSchema } from "./learning-contracts.js";

export const confirmCandidatesReadResponseSchema = confirmCandidatesResponseSchema.extend({
  analysis: analysisRecordReadSchema,
});
export type ConfirmCandidatesReadResponse = z.infer<typeof confirmCandidatesReadResponseSchema>;

export const analysisStructureEventSchema = z.strictObject({
  type: z.literal("analysis.structure"),
  requestId: resourceIdSchema,
  unit: structuredSentenceUnitSchema,
});
export const queryStructureEventSchema = z.strictObject({
  type: z.literal("query.structure"),
  generationId: resourceIdSchema,
  sequence: z.number().int().nonnegative(),
  unit: structuredSentenceUnitSchema,
});
export const analysisEventReadSchema = z.discriminatedUnion("type", [
  analysisEventSchema.options[0],
  analysisEventSchema.options[1],
  analysisEventSchema.options[2].extend({ analysis: analysisRecordReadSchema }),
  analysisEventSchema.options[3],
  analysisStructureEventSchema,
]);
export type AnalysisEventRead = z.infer<typeof analysisEventReadSchema>;
export const analysisHistoryReadResponseSchema = analysisHistoryResponseSchema.extend({
  items: z.array(analysisRecordReadSchema).max(100),
});
export const extensionQueryEventReadSchema = z.discriminatedUnion("type", [
  extensionQueryEventSchema.options[0],
  extensionQueryEventSchema.options[1],
  extensionQueryEventSchema.options[2],
  extensionQueryEventSchema.options[3].extend({ result: storeAnalysisReadResultSchema }),
  extensionQueryEventSchema.options[4],
  queryStructureEventSchema,
]);
export type ExtensionQueryEventRead = z.infer<typeof extensionQueryEventReadSchema>;
export const extensionQueryGenerationReadSchema = z.discriminatedUnion("state", [
  extensionQueryGenerationSchema.options[0],
  extensionQueryGenerationSchema.options[1].extend({ result: storeAnalysisReadResultSchema }),
  extensionQueryGenerationSchema.options[2],
]);
export type ExtensionQueryGenerationRead = z.infer<typeof extensionQueryGenerationReadSchema>;

export function projectAnalysisEventForLegacy(value: AnalysisEventRead): AnalysisEvent {
  const event = analysisEventReadSchema.parse(value);
  if (event.type === "analysis.structure")
    return analysisEventSchema.parse({
      type: "analysis.preview",
      requestId: event.requestId,
      section: `unit:${event.unit.analysisUnitId}`,
      text: projectStructuredSentencePreview(event.unit),
    });
  if (event.type === "analysis.completed")
    return analysisEventSchema.parse({
      ...event,
      analysis: projectAnalysisRecordForLegacy(event.analysis),
    });
  return analysisEventSchema.parse(event);
}
export function projectQueryEventForLegacy(value: ExtensionQueryEventRead): ExtensionQueryEvent {
  const event = extensionQueryEventReadSchema.parse(value);
  if (event.type === "query.structure")
    return extensionQueryEventSchema.parse({
      type: "query.preview",
      generationId: event.generationId,
      sequence: event.sequence,
      section: "main-structure",
      text: projectStructuredSentencePreview(event.unit),
    });
  if (event.type === "query.completed")
    return extensionQueryEventSchema.parse({
      ...event,
      result: projectStoreResultForLegacy(event.result),
    });
  return extensionQueryEventSchema.parse(event);
}
export function projectQueryGenerationForLegacy(
  value: ExtensionQueryGenerationRead,
): ExtensionQueryGeneration {
  const generation = extensionQueryGenerationReadSchema.parse(value);
  return extensionQueryGenerationSchema.parse(
    generation.state === "completed"
      ? { ...generation, result: projectStoreResultForLegacy(generation.result) }
      : generation,
  );
}
