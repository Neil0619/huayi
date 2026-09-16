import type { BackfillBatch, BackfillState } from "./shanbay-backfill-schema.js";

export function backfillHeldTargets(
  state: BackfillState,
  kind?: BackfillBatch["state"],
): Set<string> {
  return new Set(
    state.batches
      .filter((batch) => (kind ? batch.state === kind : batch.state !== "resolved"))
      .flatMap((batch) => batch.headwords),
  );
}

export function backfillDismissedTargets(state: BackfillState): Set<string> {
  return new Set(
    state.batches
      .filter((batch) => batch.state === "unknown" && batch.dismissedAt !== undefined)
      .flatMap((batch) => batch.headwords),
  );
}

export function applyBackfillDismissals(state: BackfillState, now: string): void {
  const dismissed = backfillDismissedTargets(state);
  const prepared = backfillHeldTargets(state, "prepared");
  for (const source of Object.values(state.sources)) {
    if (
      !dismissed.has(source.target) ||
      prepared.has(source.target) ||
      !["pending", "unresolved"].includes(source.state)
    )
      continue;
    source.state = "discarded";
    source.updatedAt = now;
  }
}

export function backfillReviewBatches(state: BackfillState): BackfillBatch[] {
  const dismissed = backfillDismissedTargets(state);
  return state.batches
    .filter((batch) => batch.state === "unknown" && batch.dismissedAt === undefined)
    .map((batch) => ({
      ...batch,
      headwords: batch.headwords.filter(
        (word) => !dismissed.has(word) && state.targets[word]?.confirmedAt == null,
      ),
    }))
    .filter((batch) => batch.headwords.length > 0);
}

export function discardBackfillUnknown(state: BackfillState, token: string, now: string): boolean {
  const batch = state.batches.find((batch) => batch.token === token);
  if (!batch || batch.state !== "unknown" || batch.dismissedAt !== undefined) return false;
  const prepared = backfillHeldTargets(state, "prepared");
  // A whole-batch action cannot partly dismiss active work owned by another lease.
  if (batch.headwords.some((word) => prepared.has(word))) return false;
  batch.dismissedAt = now;
  applyBackfillDismissals(state, now);
  return true;
}

export function discardAllBackfillReview(state: BackfillState, now: string): void {
  for (const batch of state.batches) discardBackfillUnknown(state, batch.token, now);
  const held = backfillHeldTargets(state);
  for (const source of Object.values(state.sources)) {
    if (source.state !== "unresolved" || held.has(source.target)) continue;
    source.state = "discarded";
    source.updatedAt = now;
  }
}

export interface BackfillDismissedEvidence {
  headwords: string[];
  dismissedAt: string;
}
export function adoptBackfillDismissed(
  state: BackfillState,
  evidence: BackfillDismissedEvidence[],
  input: { holder: string; token(): string; now: string },
): void {
  const dismissed = backfillDismissedTargets(state);
  for (const item of evidence) {
    const headwords = [...new Set(item.headwords)].filter((word) => !dismissed.has(word));
    if (headwords.length === 0) continue;
    state.batches.push({
      token: input.token(),
      holder: input.holder,
      headwords,
      state: "unknown",
      expiresAt: input.now,
      dismissedAt: item.dismissedAt,
    });
    for (const word of headwords) dismissed.add(word);
  }
  // Evidence may arrive before sources or during another device's active lease.
  applyBackfillDismissals(state, input.now);
}
