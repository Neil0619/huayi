import { z } from "zod/v3";
import { resourceIdSchema } from "./common-contracts.js";
export const practiceWorkspaceStartSchema = z.strictObject({
  itemId: resourceIdSchema,
  mode: z.enum(["guided", "free"]),
});
export const practiceWorkspaceControlSchema = z.strictObject({
  action: z.enum(["pause", "resume", "end", "skip", "free"]),
  expectedRevision: z.number().int().positive(),
  expectedControlRevision: z.number().int().nonnegative().optional(),
  draft: z.string().max(4000).optional(),
});
export const practiceWorkspaceDraftSchema = z.strictObject({
  draft: z.string().max(4000),
  expectedDraftRevision: z.number().int().nonnegative(),
});
export type PracticeWorkspaceStart = z.infer<typeof practiceWorkspaceStartSchema>;
export type PracticeWorkspaceControl = z.infer<typeof practiceWorkspaceControlSchema>;
export type PracticeWorkspaceDraft = z.infer<typeof practiceWorkspaceDraftSchema>;
