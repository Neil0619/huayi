import {
  MAX_WORD_SYNC_BATCH_SIZE,
  englishWordSchema,
  type WordSyncBatchItem,
  type WordSyncUnresolvedItem,
} from "@huayi/protocol";

import { eudicError } from "../wordbook/eudic-errors.js";
import { findUniqueLemmaCandidate } from "./word-lemma.js";
import { normalizeWord, type WordSyncState } from "./word-sync-state-schema.js";

type PendingWord = WordSyncState["pending"][number];
type ResolvedWord = WordSyncState["resolved"][number];
type UnresolvedWord = WordSyncState["unresolved"][number];

export interface BatchResolution {
  pendingCount: number;
  resolvedCount: number;
  retryCount: number;
  unresolved: WordSyncUnresolvedItem[];
  unresolvedCount: number;
}

export interface UnresolvedList {
  items: WordSyncUnresolvedItem[];
  offset: number;
  totalCount: number;
}

export interface UnresolvedRequeueResult {
  pendingCount: number;
  requeuedCount: number;
  resolvedCount: number;
  unresolvedCount: number;
}

export interface UnresolvedDiscardResult {
  discardedCount: number;
  pendingCount: number;
  unresolvedCount: number;
}

export interface UnresolvedReplacement {
  sourceWord: string;
  targetWord: string;
}

function publicUnresolved(entry: UnresolvedWord): WordSyncUnresolvedItem {
  return {
    candidates: entry.candidates,
    lastTargetWord: entry.lastTargetWord,
    reason: entry.reason,
    sourceWord: entry.sourceWord,
  };
}

function outcomeFor(entry: PendingWord): ResolvedWord["outcome"] {
  if (entry.attempt === "lemma") return "delivered-lemma";
  if (entry.attempt === "manual") return "delivered-manual";
  return "delivered-original";
}

function resolveDelivered(entry: PendingWord): ResolvedWord {
  return {
    outcome: outcomeFor(entry),
    sourceKey: entry.sourceKey,
    sourceWord: entry.sourceWord,
    targetKey: entry.targetKey,
    targetWord: entry.targetWord,
  };
}

function resolveCovered(
  entry: Pick<PendingWord, "sourceKey" | "sourceWord">,
  targetWord: string,
): ResolvedWord {
  return {
    outcome: "covered-by-target",
    sourceKey: entry.sourceKey,
    sourceWord: entry.sourceWord,
    targetKey: normalizeWord(targetWord),
    targetWord,
  };
}

function resolveDiscarded(entry: UnresolvedWord): ResolvedWord {
  return {
    outcome: "discarded",
    sourceKey: entry.sourceKey,
    sourceWord: entry.sourceWord,
    targetKey: entry.lastTargetKey,
    targetWord: entry.lastTargetWord,
  };
}

function toUnresolved(
  entry: PendingWord,
  reason: UnresolvedWord["reason"],
  candidates: string[],
): UnresolvedWord {
  return {
    attemptedTargetKeys: entry.attemptedTargetKeys,
    candidates,
    lastTargetKey: entry.targetKey,
    lastTargetWord: entry.targetWord,
    reason,
    sourceKey: entry.sourceKey,
    sourceWord: entry.sourceWord,
  };
}

export function createBatchItems(entries: readonly PendingWord[]): WordSyncBatchItem[] {
  const groups = new Map<string, PendingWord[]>();
  for (const entry of entries) {
    const group = groups.get(entry.targetKey);
    if (group === undefined) groups.set(entry.targetKey, [entry]);
    else group.push(entry);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    if (first === undefined) throw eudicError("WORD_SYNC_STATE_INVALID");
    const attempt = group.some((entry) => entry.attempt === "manual")
      ? "manual"
      : group.some((entry) => entry.attempt === "lemma")
        ? "lemma"
        : "original";
    return {
      attempt,
      sourceWords: group.map((entry) => entry.sourceWord),
      targetWord: first.targetWord,
    };
  });
}

function validatedRejectedTargets(
  activeEntries: readonly PendingWord[],
  rejectedTargets: readonly string[],
): Set<string> {
  const parsed = rejectedTargets.map((word) => englishWordSchema.safeParse(word));
  if (parsed.some((result) => !result.success)) {
    throw eudicError("WORD_SYNC_BATCH_RESULT_INVALID");
  }
  const rejected = new Set(
    parsed.flatMap((result) => (result.success ? [normalizeWord(result.data)] : [])),
  );
  const activeTargets = new Set(activeEntries.map((entry) => entry.targetKey));
  if (
    rejected.size !== rejectedTargets.length ||
    [...rejected].some((target) => !activeTargets.has(target))
  ) {
    throw eudicError("WORD_SYNC_BATCH_RESULT_INVALID");
  }
  return rejected;
}

export function resolveActiveBatch(
  state: WordSyncState,
  rejectedTargets: readonly string[],
): BatchResolution {
  const activeBatch = state.activeBatch;
  if (activeBatch === null) throw eudicError("WORD_SYNC_BATCH_MISMATCH");
  const activeSources = new Set(activeBatch.sourceKeys);
  const activeEntries = state.pending.filter((entry) => activeSources.has(entry.sourceKey));
  if (activeEntries.length !== activeSources.size) throw eudicError("WORD_SYNC_STATE_INVALID");
  const rejected = validatedRejectedTargets(activeEntries, rejectedTargets);
  const activeTargets = new Set(activeEntries.map((entry) => entry.targetKey));
  const accepted = new Set([...activeTargets].filter((target) => !rejected.has(target)));
  const delivered = new Set(state.deliveredTargetKeys);
  for (const target of accepted) delivered.add(target);

  const affectedEntries = state.pending.filter((entry) => activeTargets.has(entry.targetKey));
  const affectedSources = new Set(affectedEntries.map((entry) => entry.sourceKey));
  state.pending = state.pending.filter((entry) => !affectedSources.has(entry.sourceKey));

  const newlyResolved: ResolvedWord[] = [];
  const retries: PendingWord[] = [];
  const newlyUnresolved: UnresolvedWord[] = [];

  for (const entry of affectedEntries) {
    if (accepted.has(entry.targetKey)) {
      newlyResolved.push(resolveDelivered(entry));
      continue;
    }
    if (entry.attempt !== "original") {
      newlyUnresolved.push(
        toUnresolved(
          entry,
          entry.attempt === "lemma" ? "shanbay-rejected-lemma" : "shanbay-rejected-manual",
          [],
        ),
      );
      continue;
    }

    const lemma = findUniqueLemmaCandidate(entry.sourceWord);
    if (lemma.kind === "none") {
      newlyUnresolved.push(toUnresolved(entry, "no-lemma", []));
      continue;
    }
    if (lemma.kind === "ambiguous") {
      newlyUnresolved.push(toUnresolved(entry, "ambiguous-lemma", lemma.candidates));
      continue;
    }
    const targetKey = normalizeWord(lemma.word);
    const attemptedTargetKeys = [...entry.attemptedTargetKeys, targetKey];
    if (delivered.has(targetKey)) {
      newlyResolved.push(resolveCovered(entry, lemma.word));
      continue;
    }
    if (rejected.has(targetKey)) {
      newlyUnresolved.push(
        toUnresolved(
          { ...entry, attemptedTargetKeys, targetKey, targetWord: lemma.word },
          "shanbay-rejected-lemma",
          [],
        ),
      );
      continue;
    }
    retries.push({
      ...entry,
      attempt: "lemma",
      attemptedTargetKeys,
      targetKey,
      targetWord: lemma.word,
    });
  }

  state.deliveredTargetKeys = [...delivered];
  state.pending.push(...retries);
  state.resolved.push(...newlyResolved);
  state.unresolved.push(...newlyUnresolved);
  if (
    state.legacyReauditProbe?.status === "queued" &&
    affectedSources.has(state.legacyReauditProbe.sourceKey)
  ) {
    const probeEntry = affectedEntries.find(
      (entry) => entry.sourceKey === state.legacyReauditProbe?.sourceKey,
    );
    if (probeEntry === undefined) throw eudicError("WORD_SYNC_STATE_INVALID");
    state.legacyReauditProbe = {
      sourceKey: probeEntry.sourceKey,
      status: accepted.has(probeEntry.targetKey) ? "accepted" : "rejected",
    };
  }
  state.activeBatch = null;
  return {
    pendingCount: state.pending.length,
    resolvedCount: newlyResolved.length,
    retryCount: retries.length,
    unresolved: newlyUnresolved.slice(0, MAX_WORD_SYNC_BATCH_SIZE).map(publicUnresolved),
    unresolvedCount: state.unresolved.length,
  };
}

export function listUnresolved(
  state: WordSyncState,
  offset: number,
  limit: number,
): UnresolvedList {
  const boundedLimit = Math.min(MAX_WORD_SYNC_BATCH_SIZE, Math.max(1, limit));
  const boundedOffset = Math.max(0, offset);
  return {
    items: state.unresolved
      .slice(boundedOffset, boundedOffset + boundedLimit)
      .map(publicUnresolved),
    offset: boundedOffset,
    totalCount: state.unresolved.length,
  };
}

export function requeueUnresolved(
  state: WordSyncState,
  replacements: readonly UnresolvedReplacement[],
): UnresolvedRequeueResult {
  const uniqueSources = new Set(replacements.map((item) => normalizeWord(item.sourceWord)));
  if (uniqueSources.size !== replacements.length) {
    throw eudicError("WORD_SYNC_UNRESOLVED_MISMATCH");
  }
  const unresolvedBySource = new Map(
    state.unresolved.map((entry) => [entry.sourceKey, entry] as const),
  );
  const delivered = new Set(state.deliveredTargetKeys);
  const replacementsBySource = new Map<string, { entry: UnresolvedWord; targetWord: string }>();

  for (const replacement of replacements) {
    const source = englishWordSchema.safeParse(replacement.sourceWord);
    const target = englishWordSchema.safeParse(replacement.targetWord);
    if (!source.success || !target.success) {
      throw eudicError("WORD_SYNC_UNRESOLVED_MISMATCH");
    }
    const sourceKey = normalizeWord(source.data);
    const entry = unresolvedBySource.get(sourceKey);
    const targetKey = normalizeWord(target.data);
    if (entry === undefined || entry.attemptedTargetKeys.includes(targetKey)) {
      throw eudicError("WORD_SYNC_UNRESOLVED_MISMATCH");
    }
    replacementsBySource.set(sourceKey, { entry, targetWord: targetKey });
  }

  const newlyResolved: ResolvedWord[] = [];
  const requeued: PendingWord[] = [];
  for (const { entry, targetWord } of replacementsBySource.values()) {
    const targetKey = normalizeWord(targetWord);
    if (delivered.has(targetKey)) {
      newlyResolved.push(resolveCovered(entry, targetWord));
    } else {
      requeued.push({
        attempt: "manual",
        attemptedTargetKeys: [...entry.attemptedTargetKeys, targetKey],
        sourceKey: entry.sourceKey,
        sourceWord: entry.sourceWord,
        targetKey,
        targetWord,
      });
    }
  }
  const replacedSources = new Set(replacementsBySource.keys());
  state.unresolved = state.unresolved.filter((entry) => !replacedSources.has(entry.sourceKey));
  state.pending.push(...requeued);
  state.resolved.push(...newlyResolved);
  return {
    pendingCount: state.pending.length,
    requeuedCount: requeued.length,
    resolvedCount: newlyResolved.length,
    unresolvedCount: state.unresolved.length,
  };
}

function selectedUnresolved(
  state: WordSyncState,
  sourceWords: readonly string[],
): UnresolvedWord[] {
  const uniqueSources = new Set(sourceWords.map(normalizeWord));
  if (sourceWords.length === 0 || uniqueSources.size !== sourceWords.length) {
    throw eudicError("WORD_SYNC_UNRESOLVED_MISMATCH");
  }
  const unresolvedBySource = new Map(
    state.unresolved.map((entry) => [entry.sourceKey, entry] as const),
  );
  const selected: UnresolvedWord[] = [];
  for (const sourceWord of sourceWords) {
    const parsed = englishWordSchema.safeParse(sourceWord);
    if (!parsed.success) throw eudicError("WORD_SYNC_UNRESOLVED_MISMATCH");
    const entry = unresolvedBySource.get(normalizeWord(parsed.data));
    if (entry === undefined) throw eudicError("WORD_SYNC_UNRESOLVED_MISMATCH");
    selected.push(entry);
  }
  return selected;
}

function discardEntries(
  state: WordSyncState,
  entries: readonly UnresolvedWord[],
): UnresolvedDiscardResult {
  const sourceKeys = new Set(entries.map((entry) => entry.sourceKey));
  state.unresolved = state.unresolved.filter((entry) => !sourceKeys.has(entry.sourceKey));
  state.resolved.push(...entries.map(resolveDiscarded));
  return {
    discardedCount: entries.length,
    pendingCount: state.pending.length,
    unresolvedCount: state.unresolved.length,
  };
}

export function discardUnresolved(
  state: WordSyncState,
  sourceWords: readonly string[],
): UnresolvedDiscardResult {
  return discardEntries(state, selectedUnresolved(state, sourceWords));
}

export function discardAllUnresolved(state: WordSyncState): UnresolvedDiscardResult {
  return discardEntries(state, [...state.unresolved]);
}
