import {
  backfillHeadwordSchema,
  type BackfillState,
  type BackfillBatch,
  type BackfillOrigin,
} from "./shanbay-backfill-schema.js";

export function createBackfillState(): BackfillState {
  return { sources: {}, targets: {}, batches: [] };
}

function target(state: BackfillState, word: string) {
  if (!Object.hasOwn(state.targets, word))
    state.targets[word] = { headword: word, confirmedAt: null };
  const found = state.targets[word];
  if (!found) throw new Error("Backfill target is missing.");
  return found;
}

export function discoverBackfill(
  state: BackfillState,
  words: readonly string[],
  origin: BackfillOrigin,
  now: string,
): void {
  for (const input of words) {
    const parsed = backfillHeadwordSchema.safeParse(input);
    if (!parsed.success) continue;
    const word = parsed.data;
    if (Object.hasOwn(state.sources, word)) {
      const source = state.sources[word];
      if (!source) continue;
      if (!source.origins.includes(origin)) {
        source.origins.push(origin);
        source.updatedAt = now;
      }
      continue;
    }
    state.sources[word] = {
      headword: word,
      target: word,
      origins: [origin],
      attempt: "original",
      state: target(state, word).confirmedAt === null ? "pending" : "confirmed",
      updatedAt: now,
    };
  }
}

function blockedTargets(state: BackfillState, kind?: BackfillBatch["state"]): Set<string> {
  return new Set(
    state.batches
      .filter((batch) => (kind ? batch.state === kind : batch.state !== "resolved"))
      .flatMap((batch) => batch.headwords),
  );
}

export function backfillStatus(state: BackfillState) {
  const unknown = new Set(
    [...blockedTargets(state, "unknown")].filter(
      (word) => !Object.hasOwn(state.targets, word) || state.targets[word]?.confirmedAt == null,
    ),
  );
  return {
    pendingCount: new Set(
      Object.values(state.sources)
        .filter((source) => source.state === "pending" && !unknown.has(source.target))
        .map((source) => source.target),
    ).size,
    unresolvedCount: Object.values(state.sources).filter((source) => source.state === "unresolved")
      .length,
    unknownCount: unknown.size,
  };
}

export function expireBackfillBatches(state: BackfillState, now: string): void {
  for (const batch of state.batches) {
    if (batch.state === "prepared" && Date.parse(batch.expiresAt) <= Date.parse(now))
      batch.state = "unknown";
  }
}

interface LeaseInput {
  holder: string;
  now: string;
  token: string;
  leaseMs?: number;
}
export function claimBackfillBatch(
  state: BackfillState,
  input: LeaseInput & { limit?: number },
): BackfillBatch | null {
  expireBackfillBatches(state, input.now);
  // Tokens are never reused, including after settlement or explicit retry.
  if (state.batches.some((batch) => batch.token === input.token)) return null;
  const blocked = blockedTargets(state);
  const headwords = [
    ...new Set(
      Object.values(state.sources)
        .filter((source) => source.state === "pending" && !blocked.has(source.target))
        .map((source) => source.target),
    ),
  ].slice(0, Math.min(100, Math.max(1, input.limit ?? 100)));
  if (headwords.length === 0) return null;
  const batch: BackfillBatch = {
    token: input.token,
    holder: input.holder,
    headwords,
    state: "prepared",
    expiresAt: new Date(Date.parse(input.now) + (input.leaseMs ?? 300_000)).toISOString(),
  };
  state.batches.push(batch);
  return batch;
}

export function renewBackfillBatch(state: BackfillState, input: LeaseInput): boolean {
  const batch = state.batches.find(
    (value) => value.token === input.token && value.holder === input.holder,
  );
  if (!batch || batch.state !== "prepared" || Date.parse(batch.expiresAt) <= Date.parse(input.now))
    return false;
  batch.expiresAt = new Date(Date.parse(input.now) + (input.leaseMs ?? 300_000)).toISOString();
  return true;
}

export function markBackfillUnknown(state: BackfillState, token: string, _now: string): void {
  void _now;
  const batch = state.batches.find((value) => value.token === token);
  if (batch?.state === "prepared") batch.state = "unknown";
}

export function retryBackfillUnknown(state: BackfillState, token: string, _now: string): boolean {
  void _now;
  const batch = state.batches.find((value) => value.token === token);
  if (batch?.state !== "unknown") return false;
  batch.state = "resolved";
  return true;
}

export function confirmBackfillTargets(
  state: BackfillState,
  words: readonly string[],
  now: string,
): void {
  for (const word of words) target(state, word).confirmedAt ??= now;
  for (const source of Object.values(state.sources)) {
    if (source.state !== "discarded" && target(state, source.target).confirmedAt !== null) {
      source.state = "confirmed";
      source.updatedAt = now;
    }
  }
}

export function resolveBackfillBatch(
  state: BackfillState,
  input: LeaseInput & {
    confirmed: string[];
    rejected: string[];
    findLemma: (word: string) => string | null;
  },
): boolean {
  const batch = state.batches.find(
    (value) => value.token === input.token && value.holder === input.holder,
  );
  if (!batch || batch.state !== "prepared") return false;
  if (Date.parse(batch.expiresAt) <= Date.parse(input.now)) {
    batch.state = "unknown";
    return false;
  }
  const outcomes = [...input.confirmed, ...input.rejected];
  if (
    outcomes.some((word) => !batch.headwords.includes(word)) ||
    new Set(outcomes).size !== outcomes.length
  )
    return false;
  if (outcomes.length !== batch.headwords.length) {
    batch.state = "unknown";
    return false;
  }
  confirmBackfillTargets(state, input.confirmed, input.now);
  for (const source of Object.values(state.sources)) {
    if (source.state !== "pending" || !input.rejected.includes(source.target)) continue;
    const candidate = source.attempt === "original" ? input.findLemma(source.headword) : null;
    const lemma = backfillHeadwordSchema.safeParse(candidate);
    if (lemma.success && lemma.data !== source.target) {
      source.target = lemma.data;
      source.attempt = "lemma";
      source.state = target(state, lemma.data).confirmedAt === null ? "pending" : "confirmed";
    } else source.state = "unresolved";
    source.updatedAt = input.now;
  }
  batch.state = "resolved";
  return true;
}

export function replaceBackfillSource(
  state: BackfillState,
  key: string,
  replacement: string,
  now: string,
): boolean {
  const source = Object.hasOwn(state.sources, key) ? state.sources[key] : undefined;
  const parsed = backfillHeadwordSchema.safeParse(replacement);
  if (!source || source.state !== "unresolved" || !parsed.success) return false;
  source.target = parsed.data;
  source.attempt = "manual";
  source.state = target(state, parsed.data).confirmedAt === null ? "pending" : "confirmed";
  source.updatedAt = now;
  return true;
}

export function discardBackfillSource(state: BackfillState, key: string, now: string): boolean {
  const source = Object.hasOwn(state.sources, key) ? state.sources[key] : undefined;
  if (!source || source.state !== "unresolved") return false;
  source.state = "discarded";
  source.updatedAt = now;
  return true;
}
