import { applyBackfillDismissals, backfillHeldTargets } from "./shanbay-backfill-review.js";
import { confirmBackfillTargets, discoverBackfill } from "./shanbay-backfill.js";
import type { BackfillSource, BackfillState } from "./shanbay-backfill-schema.js";

export function adoptBackfill(
  state: BackfillState,
  sources: BackfillSource[],
  confirmed: string[],
  now: string,
): void {
  confirmBackfillTargets(state, confirmed, now);
  for (const source of sources) {
    const existed = Object.hasOwn(state.sources, source.headword);
    for (const origin of source.origins) discoverBackfill(state, [source.headword], origin, now);
    if (existed) {
      const existing = state.sources[source.headword];
      if (
        existing &&
        source.state === "discarded" &&
        existing.state !== "confirmed" &&
        !backfillHeldTargets(state, "prepared").has(existing.target)
      ) {
        existing.state = "discarded";
        existing.updatedAt = now;
      }
      continue;
    }
    const copy = { ...source, origins: [...source.origins] };
    // Source state alone is not proof of a successful target receipt.
    if (copy.state === "confirmed") copy.state = "pending";
    state.sources[copy.headword] = copy;
    if (!Object.hasOwn(state.targets, copy.target))
      state.targets[copy.target] = { headword: copy.target, confirmedAt: null };
  }
  confirmBackfillTargets(state, confirmed, now);
  applyBackfillDismissals(state, now);
}
