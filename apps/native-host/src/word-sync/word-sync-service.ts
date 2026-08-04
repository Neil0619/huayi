import { createHash, randomUUID } from "node:crypto";

import {
  MAX_WORD_SYNC_BATCH_SIZE,
  englishWordSchema,
  type ErrorCode,
  type WordSyncBatchEvent,
  type WordSyncBatchResolvedEvent,
  type WordSyncStatusEvent,
  type WordSyncUnresolvedListEvent,
  type WordSyncUnresolvedDiscardedEvent,
  type WordSyncUnresolvedRequeuedEvent,
} from "@huayi/protocol";

import { EudicProviderError, eudicError } from "../wordbook/eudic-errors.js";
import type { EudicVocabEntry } from "../wordbook/eudic-client.js";
import {
  EudicOperationExecutor,
  type EudicAuthorizationReader,
  type EudicOperationExecutorLike,
} from "../wordbook/eudic-operation-executor.js";
import {
  createBatchItems,
  discardAllUnresolved,
  discardUnresolved,
  listUnresolved,
  requeueUnresolved,
  resolveActiveBatch,
  type UnresolvedReplacement,
} from "./word-sync-resolution.js";
import { normalizeWord } from "./word-sync-state-schema.js";
import type { WordSyncState } from "./word-sync-state.js";
import type { WordSyncStateStore } from "./word-sync-state.js";

const MAXIMUM_PAGES_PER_POLL = 3;
const MAXIMUM_EUDIC_PAGE = 50;
const EUDIC_PAGE_SIZE = 100;
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export type WordSyncStatus = Omit<WordSyncStatusEvent, "requestId" | "schemaVersion" | "type">;
export type PreparedWordSyncBatch = Omit<
  WordSyncBatchEvent,
  "requestId" | "schemaVersion" | "type"
>;
export type ResolvedWordSyncBatch = Omit<
  WordSyncBatchResolvedEvent,
  "requestId" | "schemaVersion" | "type"
>;
export type ListedUnresolvedWords = Omit<
  WordSyncUnresolvedListEvent,
  "requestId" | "schemaVersion" | "type"
>;
export type RequeuedUnresolvedWords = Omit<
  WordSyncUnresolvedRequeuedEvent,
  "requestId" | "schemaVersion" | "type"
>;
export type DiscardedUnresolvedWords = Omit<
  WordSyncUnresolvedDiscardedEvent,
  "requestId" | "schemaVersion" | "type"
>;

export interface EudicWordSyncClient {
  listFavoritedWords(
    authorization: string,
    page: number,
    recentDays: number,
    signal: AbortSignal,
  ): Promise<EudicVocabEntry[]>;
}

export interface WordSyncServiceOptions {
  authorizationReader?: EudicAuthorizationReader;
  client: EudicWordSyncClient;
  createBatchId?: () => string;
  now?: () => Date;
  operationExecutor?: EudicOperationExecutorLike;
  stateStore: WordSyncStateStore;
  timeoutMs?: number;
}

class SerialWordSyncQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(eudicError("CANCELLED"));
    const execution = this.tail.then(() => {
      if (signal.aborted) throw eudicError("CANCELLED");
      return operation();
    });
    this.tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}

function skippedIdentity(value: string): string {
  return `sha256:${createHash("sha256").update(value.trim(), "utf8").digest("hex")}`;
}

function sameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isPollDue(state: WordSyncState, now: Date): boolean {
  if (state.scan !== null || state.lastSuccessfulPollAt === null) return true;
  return !sameLocalDate(new Date(state.lastSuccessfulPollAt), now);
}

function statusFromState(state: WordSyncState, now: Date): WordSyncStatus {
  return {
    historyComplete: state.historyComplete,
    lastPollSucceeded: state.lastPollSucceeded,
    pendingCount: state.pending.length,
    pollDue: isPollDue(state, now),
    scanInProgress: state.scan !== null,
    skippedCount: state.skippedCount,
    unresolvedCount: state.unresolved.length,
  };
}

function safeErrorCode(error: unknown): ErrorCode {
  return error instanceof EudicProviderError ? error.code : "INTERNAL_ERROR";
}

async function loadMutableState(
  stateStore: WordSyncStateStore,
  signal: AbortSignal,
): Promise<WordSyncState> {
  const state = await stateStore.load();
  if (signal.aborted) throw eudicError("CANCELLED");
  return state;
}

async function saveMutableState(
  stateStore: WordSyncStateStore,
  state: WordSyncState,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw eudicError("CANCELLED");
  await stateStore.save(state);
}

function addEntries(state: WordSyncState, entries: EudicVocabEntry[]): void {
  const known = new Set([
    ...state.pending.map((entry) => entry.sourceKey),
    ...state.resolved.map((entry) => entry.sourceKey),
    ...state.unresolved.map((entry) => entry.sourceKey),
  ]);
  const skipped = new Set(state.skippedKeys);
  for (const entry of entries) {
    const parsed = englishWordSchema.safeParse(entry.word);
    if (!parsed.success) {
      const identity = skippedIdentity(entry.word);
      if (!skipped.has(identity)) {
        skipped.add(identity);
        state.skippedKeys.push(identity);
        state.skippedCount += 1;
      }
      continue;
    }
    const key = normalizeWord(parsed.data);
    if (known.has(key)) continue;
    known.add(key);
    state.pending.push({
      attempt: "original",
      attemptedTargetKeys: [key],
      sourceKey: key,
      sourceWord: key,
      targetKey: key,
      targetWord: key,
    });
  }
}

export class WordSyncService {
  private readonly client: EudicWordSyncClient;
  private readonly createBatchId: () => string;
  private readonly now: () => Date;
  private readonly operationExecutor: EudicOperationExecutorLike;
  private readonly queue = new SerialWordSyncQueue();
  private readonly stateStore: WordSyncStateStore;

  constructor(options: WordSyncServiceOptions) {
    this.client = options.client;
    this.createBatchId = options.createBatchId ?? (() => `sync-${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
    if (options.operationExecutor !== undefined) {
      this.operationExecutor = options.operationExecutor;
    } else {
      if (options.authorizationReader === undefined) {
        throw new TypeError("Eudic authorization reader is required.");
      }
      this.operationExecutor = new EudicOperationExecutor({
        authorizationReader: options.authorizationReader,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
    }
    this.stateStore = options.stateStore;
  }

  status(signal: AbortSignal = NEVER_ABORTED_SIGNAL): Promise<WordSyncStatus> {
    return this.queue.run(
      async () => statusFromState(await this.stateStore.load(), this.now()),
      signal,
    );
  }

  poll(signal: AbortSignal): Promise<WordSyncStatus> {
    return this.queue.run(async () => {
      let state = await this.stateStore.load();
      const now = this.now();
      if (signal.aborted) throw eudicError("CANCELLED");
      if (state.scan === null && !isPollDue(state, now)) {
        return statusFromState(state, now);
      }
      if (state.scan === null) {
        state.scan = {
          mode: state.historyComplete ? "incremental" : "full",
          nextPage: 0,
          recentDays: 0,
          startedAt: now.toISOString(),
        };
        state.lastErrorCode = null;
        await this.stateStore.save(state);
      }

      try {
        for (let pagesRead = 0; pagesRead < MAXIMUM_PAGES_PER_POLL; pagesRead += 1) {
          if (signal.aborted) throw eudicError("CANCELLED");
          const scan = state.scan;
          if (scan === null) break;
          const entries = await this.operationExecutor.execute(
            (authorization, operationSignal) =>
              this.client.listFavoritedWords(
                authorization,
                scan.nextPage,
                scan.recentDays,
                operationSignal,
              ),
            signal,
          );
          addEntries(state, entries);

          if (entries.length < EUDIC_PAGE_SIZE) {
            if (scan.mode === "full") state.historyComplete = true;
            state.lastSuccessfulPollAt = scan.startedAt;
            state.lastPollSucceeded = true;
            state.lastErrorCode = null;
            state.scan = null;
            await this.stateStore.save(state);
            break;
          }

          if (scan.nextPage === MAXIMUM_EUDIC_PAGE) {
            state.historyComplete = false;
            state.lastPollSucceeded = false;
            state.lastErrorCode = "WORD_SYNC_HISTORY_LIMIT";
            state.scan = null;
            await this.stateStore.save(state);
            throw eudicError("WORD_SYNC_HISTORY_LIMIT");
          }
          state.scan = { ...scan, nextPage: scan.nextPage + 1 };
          await this.stateStore.save(state);
          state = await this.stateStore.load();
        }
        return statusFromState(state, this.now());
      } catch (error) {
        if (error instanceof EudicProviderError && error.code === "WORD_SYNC_HISTORY_LIMIT") {
          throw error;
        }
        state.lastPollSucceeded = false;
        state.lastErrorCode = safeErrorCode(error);
        await this.stateStore.save(state);
        throw error;
      }
    }, signal);
  }

  prepareBatch(signal: AbortSignal = NEVER_ABORTED_SIGNAL): Promise<PreparedWordSyncBatch | null> {
    return this.queue.run(async () => {
      const state = await loadMutableState(this.stateStore, signal);
      if (state.activeBatch !== null) {
        const pendingBySource = new Map(
          state.pending.map((entry) => [entry.sourceKey, entry] as const),
        );
        const entries = state.activeBatch.sourceKeys.flatMap((key) => {
          const entry = pendingBySource.get(key);
          return entry === undefined ? [] : [entry];
        });
        if (entries.length === state.activeBatch.sourceKeys.length) {
          return {
            batchId: state.activeBatch.batchId,
            items: createBatchItems(entries),
            pendingAfterBatch: state.pending.length - entries.length,
          };
        }
        state.activeBatch = null;
        await saveMutableState(this.stateStore, state, signal);
      }
      if (state.pending.length === 0) return null;
      const entries = state.pending.slice(0, MAX_WORD_SYNC_BATCH_SIZE);
      state.activeBatch = {
        batchId: this.createBatchId(),
        sourceKeys: entries.map((entry) => entry.sourceKey),
      };
      await saveMutableState(this.stateStore, state, signal);
      return {
        batchId: state.activeBatch.batchId,
        items: createBatchItems(entries),
        pendingAfterBatch: state.pending.length - entries.length,
      };
    }, signal);
  }

  resolveBatch(
    batchId: string,
    rejectedTargets: readonly string[],
    signal: AbortSignal = NEVER_ABORTED_SIGNAL,
  ): Promise<ResolvedWordSyncBatch> {
    return this.queue.run(async () => {
      const state = await loadMutableState(this.stateStore, signal);
      if (state.activeBatch?.batchId !== batchId) {
        throw eudicError("WORD_SYNC_BATCH_MISMATCH");
      }
      const result = resolveActiveBatch(state, rejectedTargets);
      await saveMutableState(this.stateStore, state, signal);
      return { batchId, ...result };
    }, signal);
  }

  listUnresolved(
    offset: number,
    limit: number,
    signal: AbortSignal = NEVER_ABORTED_SIGNAL,
  ): Promise<ListedUnresolvedWords> {
    return this.queue.run(
      async () => listUnresolved(await this.stateStore.load(), offset, limit),
      signal,
    );
  }

  requeueUnresolved(
    replacements: readonly UnresolvedReplacement[],
    signal: AbortSignal = NEVER_ABORTED_SIGNAL,
  ): Promise<RequeuedUnresolvedWords> {
    return this.queue.run(async () => {
      const state = await loadMutableState(this.stateStore, signal);
      const result = requeueUnresolved(state, replacements);
      await saveMutableState(this.stateStore, state, signal);
      return result;
    }, signal);
  }

  discardUnresolved(
    sourceWords: readonly string[],
    signal: AbortSignal = NEVER_ABORTED_SIGNAL,
  ): Promise<DiscardedUnresolvedWords> {
    return this.queue.run(async () => {
      const state = await loadMutableState(this.stateStore, signal);
      const result = discardUnresolved(state, sourceWords);
      await saveMutableState(this.stateStore, state, signal);
      return result;
    }, signal);
  }

  discardAllUnresolved(
    signal: AbortSignal = NEVER_ABORTED_SIGNAL,
  ): Promise<DiscardedUnresolvedWords> {
    return this.queue.run(async () => {
      const state = await loadMutableState(this.stateStore, signal);
      const result = discardAllUnresolved(state);
      await saveMutableState(this.stateStore, state, signal);
      return result;
    }, signal);
  }
}
