import { z } from "zod/v3";
import { resourceIdSchema } from "./common-contracts.js";
export const practiceWorkspaceStartSchema = z
  .strictObject({
    itemId: resourceIdSchema,
    mode: z.enum(["guided", "free"]),
    teachingContract: z.literal("practice-teaching-v1").optional(),
    hintPolicy: z.literal("on-demand").optional(),
  })
  .refine(
    (request) =>
      request.hintPolicy === undefined ||
      (request.teachingContract !== undefined && request.mode === "guided"),
    {
      message: "On-demand hints require a guided teaching workspace.",
    },
  );
export const practiceWorkspaceControlSchema = z.strictObject({
  action: z.enum(["pause", "resume", "end", "skip", "free"]),
  expectedRevision: z.number().int().positive(),
  expectedControlRevision: z.number().int().nonnegative().optional(),
  expectedDraftRevision: z.number().int().nonnegative().optional(),
  draft: z.string().max(4000).optional(),
});
export const practiceWorkspaceDraftSchema = z.strictObject({
  draft: z.string().max(4000),
  expectedDraftRevision: z.number().int().nonnegative(),
});
export type PracticeWorkspaceStart = z.infer<typeof practiceWorkspaceStartSchema>;
export type PracticeWorkspaceControl = z.infer<typeof practiceWorkspaceControlSchema>;
export type PracticeWorkspaceDraft = z.infer<typeof practiceWorkspaceDraftSchema>;
