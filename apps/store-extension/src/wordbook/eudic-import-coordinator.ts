import { eudicImportJobSchema, type EudicImportJob } from "@huayi/store-domain";

import type { EudicFailure } from "./wordbook-errors.js";
import type { WordbookPersistentState, WordbookStateStore } from "./wordbook-state.js";

export interface ClaimedImport {
  readonly page: number;
  readonly token: string;
}

export interface ImportedResult {
  readonly entryId: string;
  readonly existed: boolean;
}

interface EudicImportCoordinatorOptions {
  readonly clock: () => Date;
  readonly leaseDurationMs: number;
  readonly randomId: () => string;
  readonly stateStore: WordbookStateStore;
  readonly update: <Result>(
    operation: (state: WordbookPersistentState) => Result,
  ) => Promise<Result>;
}

function timestamp(date: Date): string {
  return date.toISOString();
}

export class EudicImportCoordinator {
  constructor(private readonly options: EudicImportCoordinatorOptions) {}

  async start(): Promise<EudicImportJob> {
    const now = timestamp(this.options.clock());
    return this.options.update((state) => {
      if (state.importJob.state !== "idle") return state.importJob;
      state.importJob = {
        duplicateCount: 0,
        importedCount: 0,
        nextPage: 0,
        state: "running",
        updatedAt: now,
      };
      state.importSeenEntryIds = [];
      delete state.importLease;
      return state.importJob;
    });
  }

  async resume(): Promise<EudicImportJob> {
    const now = timestamp(this.options.clock());
    return this.options.update((state) => {
      if (state.importJob.state === "paused" || state.importJob.state === "failed") {
        const job = { ...state.importJob };
        delete job.lastError;
        state.importJob = { ...job, state: "running", updatedAt: now };
        delete state.importLease;
      }
      return state.importJob;
    });
  }

  async pause(): Promise<EudicImportJob> {
    const now = timestamp(this.options.clock());
    return this.options.update((state) => {
      if (state.importJob.state === "running") {
        state.importJob = { ...state.importJob, state: "paused", updatedAt: now };
        delete state.importLease;
      }
      return state.importJob;
    });
  }

  async get(): Promise<EudicImportJob> {
    return eudicImportJobSchema.parse((await this.options.stateStore.read()).state.importJob);
  }

  async claim(): Promise<ClaimedImport | null> {
    const nowDate = this.options.clock();
    const expiresAt = timestamp(new Date(nowDate.getTime() + this.options.leaseDurationMs));
    return this.options.update((state) => {
      if (state.importJob.state !== "running" || state.importJob.nextPage > 50) return null;
      if (
        state.importLease !== undefined &&
        Date.parse(state.importLease.expiresAt) > nowDate.getTime()
      ) {
        return null;
      }
      const token = this.options.randomId();
      state.importLease = { expiresAt, token };
      return { page: state.importJob.nextPage, token };
    });
  }

  async finishPage(
    claim: ClaimedImport,
    imported: readonly ImportedResult[],
    pageSize: number,
    fullPageSize: number,
  ): Promise<void> {
    const now = timestamp(this.options.clock());
    await this.options.update((state) => {
      if (state.importLease?.token !== claim.token || state.importJob.state !== "running") return;
      const seen = new Set(state.importSeenEntryIds);
      for (const item of imported) {
        if (seen.has(item.entryId)) continue;
        seen.add(item.entryId);
        if (item.existed) state.importJob.duplicateCount += 1;
        else state.importJob.importedCount += 1;
        this.ensureImportedOutbox(state, item.entryId, now);
      }
      state.importSeenEntryIds = [...seen];
      delete state.importLease;
      if (pageSize < fullPageSize) {
        state.importJob = { ...state.importJob, state: "completed", updatedAt: now };
      } else if (claim.page === 50) {
        state.importJob = {
          ...state.importJob,
          nextPage: 51,
          state: "source-limit-reached",
          updatedAt: now,
        };
      } else {
        state.importJob = {
          ...state.importJob,
          nextPage: claim.page + 1,
          state: "running",
          updatedAt: now,
        };
      }
    });
  }

  async fail(claim: ClaimedImport, lastError: EudicFailure): Promise<void> {
    const now = timestamp(this.options.clock());
    await this.options.update((state) => {
      if (state.importLease?.token !== claim.token) return;
      delete state.importLease;
      state.importJob = { ...state.importJob, lastError, state: "failed", updatedAt: now };
    });
  }

  private ensureImportedOutbox(state: WordbookPersistentState, entryId: string, now: string): void {
    if (!state.outbox.some((item) => item.entryId === entryId && item.target === "eudic")) {
      state.outbox.push({
        attemptCount: 0,
        createdAt: now,
        entryId,
        id: this.options.randomId(),
        receipt: { entryId, outcome: "already-present", recordedAt: now, target: "eudic" },
        state: "delivered",
        target: "eudic",
        updatedAt: now,
      });
    }
    if (
      !state.outbox.some(
        (item) =>
          item.entryId === entryId && item.target === "shanbay" && item.state !== "cancelled",
      )
    ) {
      state.outbox.push({
        attemptCount: 0,
        createdAt: now,
        entryId,
        id: this.options.randomId(),
        state: "queued",
        target: "shanbay",
        updatedAt: now,
      });
    }
  }
}
