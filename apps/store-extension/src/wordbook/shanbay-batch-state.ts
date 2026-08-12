import type { ShanbayBatch } from "@huayi/store-domain";

import type { StoredOutboxItem, WordbookPersistentState } from "./wordbook-state.js";

interface ClaimShanbayBatchOptions {
  readonly leaseDurationMs: number;
  readonly limit: number;
  readonly now: Date;
  readonly randomId: () => string;
}

function timestamp(date: Date): string {
  return date.toISOString();
}

function withoutLease(item: StoredOutboxItem): StoredOutboxItem {
  const result = { ...item };
  delete result.lease;
  return result;
}

export function claimShanbayBatchInState(
  state: WordbookPersistentState,
  options: ClaimShanbayBatchOptions,
): ShanbayBatch | null {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new RangeError("Shanbay batch limit must be between 1 and 100.");
  }
  const now = timestamp(options.now);
  const expiresAt = timestamp(new Date(options.now.getTime() + options.leaseDurationMs));
  const candidates = state.outbox
    .filter(
      (item) =>
        item.target === "shanbay" &&
        (item.state === "queued" ||
          (item.state === "in-flight" &&
            item.lease !== undefined &&
            Date.parse(item.lease.expiresAt) <= options.now.getTime())),
    )
    .slice(0, options.limit);
  if (candidates.length === 0) return null;
  const token = options.randomId();
  const candidateIds = new Set(candidates.map((item) => item.id));
  state.outbox = state.outbox.map((item) =>
    candidateIds.has(item.id)
      ? {
          ...item,
          attemptCount: item.attemptCount + 1,
          lease: { expiresAt, token },
          state: "in-flight" as const,
          updatedAt: now,
        }
      : item,
  );
  return {
    items: candidates.map((item) => ({ entryId: item.entryId, outboxId: item.id })),
    token,
  };
}

export function resolveShanbayBatchInState(
  state: WordbookPersistentState,
  nowDate: Date,
  token: string,
  confirmedOutboxIds: readonly string[],
  failedOutboxIds: readonly string[],
): boolean {
  const confirmed = new Set(confirmedOutboxIds);
  const failed = new Set(failedOutboxIds);
  if (
    token.length === 0 ||
    confirmed.size !== confirmedOutboxIds.length ||
    failed.size !== failedOutboxIds.length ||
    [...confirmed].some((id) => failed.has(id))
  ) {
    return false;
  }
  const leased = state.outbox.filter(
    (item) =>
      item.target === "shanbay" &&
      item.state === "in-flight" &&
      item.lease?.token === token &&
      Date.parse(item.lease.expiresAt) > nowDate.getTime(),
  );
  const reported = new Set([...confirmed, ...failed]);
  if (
    leased.length === 0 ||
    leased.length !== reported.size ||
    leased.some((item) => !reported.has(item.id))
  ) {
    return false;
  }
  const now = timestamp(nowDate);
  state.outbox = state.outbox.map((item) => {
    if (item.target !== "shanbay" || item.state !== "in-flight" || item.lease?.token !== token) {
      return item;
    }
    const released = withoutLease(item);
    if (failed.has(item.id)) return { ...released, state: "queued" as const, updatedAt: now };
    return {
      ...released,
      receipt: {
        entryId: item.entryId,
        outcome: "confirmed" as const,
        recordedAt: now,
        target: "shanbay" as const,
      },
      state: "delivered" as const,
      updatedAt: now,
    };
  });
  return true;
}
