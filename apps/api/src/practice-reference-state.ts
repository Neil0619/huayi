import { createHash } from "node:crypto";
import { z } from "zod/v3";
import {
  dailyPracticeQueueItemSchema,
  practiceReferenceDetailSchema,
  practiceReferenceResultSchema,
} from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";
import { loadPracticeSession } from "./postgres-practice-view.js";
import { readPracticeTeachingState } from "./postgres-practice-teaching-view.js";
import { practiceWorkspaceState } from "./practice-workspace.js";

export const referenceInputSchema = z.strictObject({
  itemContent: dailyPracticeQueueItemSchema.shape.item.shape.content,
  prompt: z.string().min(1).max(4000),
  mode: z.enum(["guided", "free"]),
});
export const referenceStateSchema = z.strictObject({
  version: z.literal(1),
  identity: z.string().regex(/^[a-f0-9]{64}$/u),
  generationId: z.string().uuid(),
  result: practiceReferenceResultSchema.nullable(),
  views: z
    .array(
      z.strictObject({
        ordinal: z.number().int().min(0).max(4),
        viewedAt: z.string().datetime({ offset: true }),
      }),
    )
    .max(5),
});
export type ReferenceState = z.infer<typeof referenceStateSchema>;
export const referenceDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function referenceContext(query: AnalysisQuery, id: string) {
  const session = await loadPracticeSession(query, id);
  const teaching = await readPracticeTeachingState(query, id);
  const workspace = practiceWorkspaceState(session);
  const rows = await query.rows<{
    content: unknown;
    updated_at: Date;
    deleted_at: Date | null;
    archived_at: Date | null;
  }>("SELECT content,updated_at,deleted_at,archived_at FROM learning_items WHERE id=$1", [
    session.items[0]?.itemId ?? null,
  ]);
  const item = rows[0];
  const target =
    teaching?.target.state === "available"
      ? teaching.target.content
      : !teaching && item && item.updated_at.getTime() <= Date.parse(session.createdAt)
        ? item.content
        : null;
  const content = dailyPracticeQueueItemSchema.shape.item.shape.content.safeParse(target);
  const input =
    session.type === "sentence-creation" &&
    session.prompt &&
    content.success &&
    item &&
    !item.deleted_at &&
    !item.archived_at
      ? referenceInputSchema.parse({
          itemContent: content.data,
          prompt: session.prompt,
          mode: workspace.mode,
        })
      : null;
  const stored = await query.rows<{ reference_state: unknown }>(
    "SELECT to_jsonb(practice_sessions)->'reference_state' reference_state FROM practice_sessions WHERE id=$1",
    [id],
  );
  const parsed =
    stored[0]?.reference_state == null
      ? null
      : referenceStateSchema.parse(stored[0].reference_state);
  const identity = input ? referenceDigest(input) : null;
  const state = parsed?.identity === identity ? parsed : null;
  const ordinal =
    teaching?.round.ordinal ??
    Math.max(0, (session.attempts?.length ?? 0) - (session.status === "active" ? 0 : 1));
  const availability =
    !content.success ||
    item?.deleted_at ||
    item?.archived_at ||
    session.type !== "sentence-creation"
      ? "target-unavailable"
      : session.pendingGeneration === "sentence-prompt"
        ? "pending-prompt"
        : session.status !== "active" || workspace.phase !== "active"
          ? "inactive"
          : "available";
  return { session, teaching, workspace, input, identity, state, ordinal, availability } as const;
}
export function referenceDetail(context: Awaited<ReturnType<typeof referenceContext>>) {
  const viewedAt =
    context.state?.views.find((v) => v.ordinal === context.ordinal)?.viewedAt ?? null;
  return practiceReferenceDetailSchema.parse({
    version: 1,
    sessionId: context.session.id,
    revision: context.session.revision,
    controlRevision: context.workspace.controlRevision ?? 0,
    ordinal: context.ordinal,
    availability: context.availability,
    ready: Boolean(context.state?.result),
    viewedAt,
    reference: viewedAt ? (context.state?.result ?? null) : null,
  });
}
export function referenceVersionsMatch(
  context: Awaited<ReturnType<typeof referenceContext>>,
  request: { expectedRevision: number; expectedControlRevision: number; ordinal: number },
) {
  return (
    context.session.revision === request.expectedRevision &&
    (context.workspace.controlRevision ?? 0) === request.expectedControlRevision &&
    context.ordinal === request.ordinal
  );
}
