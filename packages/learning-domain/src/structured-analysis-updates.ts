import { z } from "zod/v3";
import { analysisUpdateSchema } from "./analysis-updates.js";
import { structuredSentenceUnitSchema } from "./structured-sentence-unit.js";
import { validateStructuredPayloadBudget } from "./structured-payload-budget.js";

const structureUpdateSchema = z
  .strictObject({
    type: z.literal("structure"),
    requestId: z.string().trim().min(1).max(64),
    sequence: z.number().int().nonnegative().safe(),
    unit: structuredSentenceUnitSchema,
  })
  .superRefine((value, context) => {
    try {
      validateStructuredPayloadBudget(value);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      for (const issue of error.issues) context.addIssue(issue);
    }
  });

/** Additive Store-native update; legacy update and Classic wire schemas stay frozen. */
export const analysisUpdateReadSchema = z.union([analysisUpdateSchema, structureUpdateSchema]);
export type AnalysisUpdateRead = z.infer<typeof analysisUpdateReadSchema>;
