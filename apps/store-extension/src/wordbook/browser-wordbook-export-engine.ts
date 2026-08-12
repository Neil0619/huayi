import {
  exportOutboxStateSchema,
  exportTargetSchema,
  normalizeHeadword,
  type EudicImportJob,
  type ExportOutboxItem,
  type ExportOutboxState,
  type ExportTarget,
  type LexiconRepository,
  type WordbookExportEngine,
} from "@huayi/store-domain";

import { EUDIC_LIST_PAGE_SIZE, type EudicWordbookClient } from "./eudic-client.js";
import { EudicImportCoordinator, type ImportedResult } from "./eudic-import-coordinator.js";
import { eudicFailureCode } from "./wordbook-errors.js";
import { claimShanbayBatchInState, resolveShanbayBatchInState } from "./shanbay-batch-state.js";
import {
  publicOutboxItem,
  type StoredOutboxItem,
  type WordbookPersistentState,
  type WordbookStateStore,
} from "./wordbook-state.js";

const MAX_CAS_ATTEMPTS = 5;

interface BrowserWordbookExportEngineOptions {
  readonly clock: () => Date;
  readonly eudic: EudicWordbookClient;
  readonly leaseDurationMs: number;
  readonly lexicon: LexiconRepository;
  readonly randomId: () => string;
  readonly stateStore: WordbookStateStore;
}

interface ClaimedOutbox {
  readonly id: string;
  readonly item: ExportOutboxItem;
  readonly token: string;
}

function timestamp(date: Date): string {
  return date.toISOString();
}

function firstContext(
  entry: Awaited<ReturnType<LexiconRepository["findByHeadword"]>>,
): string | undefined {
  return entry?.contexts[0]?.sentence;
}

function withoutLease(item: StoredOutboxItem): StoredOutboxItem {
  const result = { ...item };
  delete result.lease;
  return result;
}

export class BrowserWordbookExportEngine implements WordbookExportEngine {
  private readonly importCoordinator: EudicImportCoordinator;

  constructor(private readonly options: BrowserWordbookExportEngineOptions) {
    if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
      throw new RangeError("Wordbook lease duration must be a positive safe integer.");
    }
    this.importCoordinator = new EudicImportCoordinator({
      clock: options.clock,
      leaseDurationMs: options.leaseDurationMs,
      randomId: options.randomId,
      stateStore: options.stateStore,
      update: (operation) => this.update(operation),
    });
  }

  async enqueue(
    entryId: string,
    targets: readonly ExportTarget[],
  ): Promise<readonly ExportOutboxItem[]> {
    const normalizedEntryId = normalizeHeadword(entryId);
    const parsedTargets = [...new Set(targets.map((target) => exportTargetSchema.parse(target)))];
    const now = timestamp(this.options.clock());
    return this.update((state) => {
      const items: ExportOutboxItem[] = [];
      for (const target of parsedTargets) {
        const existing = state.outbox.find(
          (item) =>
            item.entryId === normalizedEntryId &&
            item.target === target &&
            item.state !== "cancelled",
        );
        if (existing !== undefined) {
          items.push(publicOutboxItem(existing));
          continue;
        }
        const item: StoredOutboxItem = {
          attemptCount: 0,
          createdAt: now,
          entryId: normalizedEntryId,
          id: this.options.randomId(),
          state: "queued",
          target,
          updatedAt: now,
        };
        state.outbox.push(item);
        items.push(publicOutboxItem(item));
      }
      return items;
    });
  }

  async cancelEntry(entryId: string): Promise<void> {
    const normalizedEntryId = normalizeHeadword(entryId);
    const now = timestamp(this.options.clock());
    await this.update((state) => {
      for (const [index, item] of state.outbox.entries()) {
        if (
          item.entryId === normalizedEntryId &&
          (item.state === "queued" ||
            item.state === "failed" ||
            (item.state === "in-flight" && item.target === "shanbay"))
        ) {
          state.outbox[index] = {
            ...withoutLease(item),
            state: "cancelled",
            updatedAt: now,
          };
        }
      }
    });
  }

  async claimShanbayBatch(limit: number) {
    const nowDate = this.options.clock();
    return this.update((state) =>
      claimShanbayBatchInState(state, {
        leaseDurationMs: this.options.leaseDurationMs,
        limit,
        now: nowDate,
        randomId: this.options.randomId,
      }),
    );
  }

  async listOutbox(states?: readonly ExportOutboxState[]): Promise<readonly ExportOutboxItem[]> {
    const allowed =
      states === undefined
        ? null
        : new Set(states.map((state) => exportOutboxStateSchema.parse(state)));
    const snapshot = await this.options.stateStore.read();
    return snapshot.state.outbox
      .filter((item) => allowed === null || allowed.has(item.state))
      .map(publicOutboxItem)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
  }

  async retry(outboxId: string): Promise<void> {
    const now = timestamp(this.options.clock());
    await this.update((state) => {
      const index = state.outbox.findIndex((item) => item.id === outboxId);
      const item = state.outbox[index];
      if (item === undefined || item.state !== "failed") return;
      const retryable = withoutLease(item);
      delete retryable.lastError;
      state.outbox[index] = { ...retryable, state: "queued", updatedAt: now };
    });
  }

  async startEudicImport(): Promise<EudicImportJob> {
    return this.importCoordinator.start();
  }

  async resumeEudicImport(): Promise<EudicImportJob> {
    return this.importCoordinator.resume();
  }

  async pauseEudicImport(): Promise<EudicImportJob> {
    return this.importCoordinator.pause();
  }

  async getEudicImportJob(): Promise<EudicImportJob> {
    return this.importCoordinator.get();
  }

  async processEudicOnce(signal: AbortSignal = new AbortController().signal): Promise<boolean> {
    const claim = await this.claimEudicOutbox();
    if (claim === null) return false;
    const entry = await this.options.lexicon.findByHeadword(claim.item.entryId);
    if (entry === null) {
      await this.finishOutbox(claim, "cancelled", "entry-missing");
      return true;
    }
    try {
      const outcome = await this.options.eudic.addWord(entry.headword, firstContext(entry), signal);
      await this.deliverOutbox(claim, outcome);
    } catch (error) {
      await this.finishOutbox(claim, "failed", eudicFailureCode(error));
    }
    return true;
  }

  async processEudicImportOnce(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<boolean> {
    const claim = await this.importCoordinator.claim();
    if (claim === null) return false;
    try {
      const remoteEntries = await this.options.eudic.listWords(claim.page, signal);
      const imported: ImportedResult[] = [];
      for (const remote of remoteEntries) {
        const existing = await this.options.lexicon.findByHeadword(remote.headword);
        await this.options.lexicon.save({
          ...(remote.contextLine === undefined
            ? {}
            : {
                context: {
                  observedAt: remote.addedAt,
                  sentence: remote.contextLine,
                  source: "eudic-import" as const,
                },
              }),
          headword: remote.headword,
        });
        imported.push({ entryId: remote.headword, existed: existing !== null });
      }
      await this.importCoordinator.finishPage(
        claim,
        imported,
        remoteEntries.length,
        EUDIC_LIST_PAGE_SIZE,
      );
    } catch (error) {
      await this.importCoordinator.fail(claim, eudicFailureCode(error));
    }
    return true;
  }

  async resolveShanbayBatch(
    token: string,
    confirmedOutboxIds: readonly string[],
    failedOutboxIds: readonly string[],
  ): Promise<boolean> {
    const nowDate = this.options.clock();
    return this.update((state) =>
      resolveShanbayBatchInState(state, nowDate, token, confirmedOutboxIds, failedOutboxIds),
    );
  }

  private async update<Result>(
    operation: (state: WordbookPersistentState) => Result,
  ): Promise<Result> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const snapshot = await this.options.stateStore.read();
      const state = structuredClone(snapshot.state);
      const result = operation(state);
      if (await this.options.stateStore.compareAndSwap(snapshot.revision, state)) return result;
    }
    throw Object.assign(new Error("Wordbook state changed concurrently."), {
      code: "concurrent-modification",
    });
  }

  private async claimEudicOutbox(): Promise<ClaimedOutbox | null> {
    const nowDate = this.options.clock();
    const now = timestamp(nowDate);
    const expiresAt = timestamp(new Date(nowDate.getTime() + this.options.leaseDurationMs));
    return this.update((state) => {
      const index = state.outbox.findIndex(
        (item) =>
          item.target === "eudic" &&
          (item.state === "queued" ||
            (item.state === "in-flight" &&
              item.lease !== undefined &&
              Date.parse(item.lease.expiresAt) <= nowDate.getTime())),
      );
      const item = state.outbox[index];
      if (item === undefined) return null;
      const token = this.options.randomId();
      const claimed: StoredOutboxItem = {
        ...item,
        attemptCount: item.attemptCount + 1,
        lease: { expiresAt, token },
        state: "in-flight",
        updatedAt: now,
      };
      state.outbox[index] = claimed;
      return { id: claimed.id, item: publicOutboxItem(claimed), token };
    });
  }

  private async finishOutbox(
    claim: ClaimedOutbox,
    stateValue: "cancelled" | "failed",
    lastError: NonNullable<ExportOutboxItem["lastError"]>,
  ): Promise<void> {
    const now = timestamp(this.options.clock());
    await this.update((state) => {
      const index = state.outbox.findIndex((item) => item.id === claim.id);
      const item = state.outbox[index];
      if (item?.state !== "in-flight" || item.lease?.token !== claim.token) return;
      state.outbox[index] = {
        ...withoutLease(item),
        lastError,
        state: stateValue,
        updatedAt: now,
      };
    });
  }

  private async deliverOutbox(
    claim: ClaimedOutbox,
    outcome: "already-present" | "created",
  ): Promise<void> {
    const now = timestamp(this.options.clock());
    await this.update((state) => {
      const index = state.outbox.findIndex((item) => item.id === claim.id);
      const item = state.outbox[index];
      if (item?.state !== "in-flight" || item.lease?.token !== claim.token) return;
      state.outbox[index] = {
        ...withoutLease(item),
        receipt: { entryId: item.entryId, outcome, recordedAt: now, target: "eudic" },
        state: "delivered",
        updatedAt: now,
      };
    });
  }
}

export function createBrowserWordbookExportEngine(
  options: BrowserWordbookExportEngineOptions,
): BrowserWordbookExportEngine {
  return new BrowserWordbookExportEngine(options);
}
