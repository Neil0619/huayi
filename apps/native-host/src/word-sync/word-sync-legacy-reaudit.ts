import { englishWordSchema } from "@huayi/protocol";

import { normalizeWord } from "./word-sync-state-schema.js";
import type { WordSyncStateStore } from "./word-sync-state.js";

export interface LegacyReauditOptions {
  confirm: boolean;
  probe?: string;
}

export interface LegacyReauditResult {
  dryRun: boolean;
  legacyCount: number;
  requeuedCount: number;
}

export async function reauditLegacyCompleted(
  stateStore: WordSyncStateStore,
  options: LegacyReauditOptions,
): Promise<LegacyReauditResult> {
  const state = await stateStore.load({ persistMigration: options.confirm });
  const legacy = state.resolved.filter((entry) => entry.outcome === "legacy-completed");
  const selected =
    options.probe === undefined
      ? legacy
      : legacy.filter(
          (entry) => entry.sourceKey === normalizeWord(englishWordSchema.parse(options.probe)),
        );
  if (options.probe !== undefined && selected.length !== 1) {
    throw new Error("The probe word is not present in the legacy-completed set.");
  }
  if (!options.confirm) {
    return { dryRun: true, legacyCount: legacy.length, requeuedCount: 0 };
  }
  if (state.activeBatch !== null) {
    throw new Error("Legacy re-audit is blocked while an active batch exists.");
  }
  if (
    options.probe === undefined &&
    legacy.length > 0 &&
    state.legacyReauditProbe?.status !== "accepted"
  ) {
    throw new Error("Legacy re-audit requires an accepted probe before the full requeue.");
  }
  if (options.probe !== undefined && state.legacyReauditProbe !== null) {
    throw new Error("A legacy re-audit probe was already recorded.");
  }

  const selectedSources = new Set(selected.map((entry) => entry.sourceKey));
  state.resolved = state.resolved.filter((entry) => !selectedSources.has(entry.sourceKey));
  state.pending.push(
    ...selected.map((entry) => ({
      attempt: "original" as const,
      attemptedTargetKeys: [entry.sourceKey],
      sourceKey: entry.sourceKey,
      sourceWord: entry.sourceWord,
      targetKey: entry.sourceKey,
      targetWord: entry.sourceWord,
    })),
  );
  if (options.probe !== undefined) {
    const probeEntry = selected[0];
    if (probeEntry === undefined) {
      throw new Error("The probe word is not present in the legacy-completed set.");
    }
    state.legacyReauditProbe = {
      sourceKey: probeEntry.sourceKey,
      status: "queued",
    };
  }
  if (selected.length > 0) await stateStore.save(state);
  return {
    dryRun: false,
    legacyCount: legacy.length,
    requeuedCount: selected.length,
  };
}
