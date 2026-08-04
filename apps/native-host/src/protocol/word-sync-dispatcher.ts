import { SCHEMA_VERSION, hostEventSchema } from "@huayi/protocol";
import type {
  AnalysisError,
  HostEvent,
  WordSyncListUnresolvedRequest,
  WordSyncDiscardAllUnresolvedRequest,
  WordSyncDiscardUnresolvedRequest,
  WordSyncPollRequest,
  WordSyncPrepareBatchRequest,
  WordSyncRequeueUnresolvedRequest,
  WordSyncResolveBatchRequest,
  WordSyncStatusRequest,
} from "@huayi/protocol";

import type { RequestQueue } from "../runtime/request-queue.js";
import type {
  ListedUnresolvedWords,
  DiscardedUnresolvedWords,
  PreparedWordSyncBatch,
  RequeuedUnresolvedWords,
  ResolvedWordSyncBatch,
  WordSyncStatus,
} from "../word-sync/word-sync-service.js";
import type { HostEventEmitter } from "./dispatcher.js";

export interface WordSyncServiceLike {
  discardAllUnresolved(signal: AbortSignal): Promise<DiscardedUnresolvedWords>;
  discardUnresolved(
    sourceWords: readonly string[],
    signal: AbortSignal,
  ): Promise<DiscardedUnresolvedWords>;
  listUnresolved(
    offset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ListedUnresolvedWords>;
  poll(signal: AbortSignal): Promise<WordSyncStatus>;
  prepareBatch(signal: AbortSignal): Promise<PreparedWordSyncBatch | null>;
  requeueUnresolved(
    items: readonly { sourceWord: string; targetWord: string }[],
    signal: AbortSignal,
  ): Promise<RequeuedUnresolvedWords>;
  resolveBatch(
    batchId: string,
    rejectedTargets: readonly string[],
    signal: AbortSignal,
  ): Promise<ResolvedWordSyncBatch>;
  status(signal: AbortSignal): Promise<WordSyncStatus>;
}

export interface WordSyncRequestDispatcherOptions {
  mapError(error: unknown): AnalysisError;
  queue: RequestQueue;
  service: WordSyncServiceLike | undefined;
}

export class WordSyncRequestDispatcher {
  private readonly mapError: WordSyncRequestDispatcherOptions["mapError"];
  private readonly queue: RequestQueue;
  private readonly service: WordSyncServiceLike | undefined;

  constructor(options: WordSyncRequestDispatcherOptions) {
    this.mapError = options.mapError;
    this.queue = options.queue;
    this.service = options.service;
  }

  status(request: WordSyncStatusRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.status(signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-status",
    }));
  }

  poll(request: WordSyncPollRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.poll(signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-status",
    }));
  }

  prepare(request: WordSyncPrepareBatchRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => {
      const batch = await service.prepareBatch(signal);
      if (batch === null) {
        return {
          ...(await service.status(signal)),
          requestId: request.requestId,
          schemaVersion: SCHEMA_VERSION,
          type: "word-sync-status",
        };
      }
      return {
        ...batch,
        requestId: request.requestId,
        schemaVersion: SCHEMA_VERSION,
        type: "word-sync-batch",
      };
    });
  }

  resolve(request: WordSyncResolveBatchRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.resolveBatch(request.batchId, request.rejectedTargets, signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-batch-resolved",
    }));
  }

  listUnresolved(request: WordSyncListUnresolvedRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.listUnresolved(request.offset, request.limit, signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-unresolved-list",
    }));
  }

  requeueUnresolved(request: WordSyncRequeueUnresolvedRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.requeueUnresolved(request.items, signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-unresolved-requeued",
    }));
  }

  discardUnresolved(request: WordSyncDiscardUnresolvedRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.discardUnresolved(request.sourceWords, signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-unresolved-discarded",
    }));
  }

  discardAllUnresolved(request: WordSyncDiscardAllUnresolvedRequest, emit: HostEventEmitter): void {
    this.enqueue(request.requestId, emit, async (service, signal) => ({
      ...(await service.discardAllUnresolved(signal)),
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-unresolved-discarded",
    }));
  }

  private enqueue(
    requestId: string,
    emit: HostEventEmitter,
    operation: (service: WordSyncServiceLike, signal: AbortSignal) => Promise<HostEvent>,
  ): void {
    const service = this.requireService(requestId, emit);
    if (service === null) return;
    try {
      this.queue.enqueue(requestId, async (signal) => {
        try {
          const event = await operation(service, signal);
          const validatedEvent = hostEventSchema.parse(event);
          if (signal.aborted || !this.queue.markTerminal(requestId)) return;
          emit(validatedEvent);
        } catch (error) {
          if (!signal.aborted && this.queue.markTerminal(requestId)) {
            this.emitError(emit, requestId, this.mapError(error));
          }
        }
      });
    } catch (error) {
      this.emitError(emit, requestId, this.mapError(error));
    }
  }

  private requireService(requestId: string, emit: HostEventEmitter): WordSyncServiceLike | null {
    if (this.service !== undefined) return this.service;
    this.emitError(emit, requestId, {
      code: "EUDIC_NOT_CONFIGURED",
      message: "尚未配置欧路授权，请先运行配置命令。",
      retryable: false,
    });
    return null;
  }

  private emitError(emit: HostEventEmitter, requestId: string, error: AnalysisError): void {
    this.emitValidated(emit, {
      error,
      requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "error",
    });
  }

  private emitValidated(emit: HostEventEmitter, event: HostEvent): void {
    emit(hostEventSchema.parse(event));
  }
}
