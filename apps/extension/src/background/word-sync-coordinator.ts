import { SCHEMA_VERSION } from "@huayi/protocol";
import type {
  AnalysisError,
  HostEvent,
  WordSyncBatchEvent,
  WordSyncBatchResolvedEvent,
  WordSyncRequeueUnresolvedRequest,
  WordSyncRequest,
  WordSyncStatusEvent,
  WordSyncUnresolvedDiscardedEvent,
  WordSyncUnresolvedListEvent,
  WordSyncUnresolvedRequeuedEvent,
} from "@huayi/protocol";

import type { ShanbayBackgroundMessage } from "../shared/extension-messages.js";
import type { NativeDisconnect, NativeTransport } from "./native-transport.js";
import {
  acceptsWordSyncStatus,
  attachPrepareToPendingPoll,
  DEFAULT_WORD_SYNC_TIMEOUT_MS,
  hostUnavailableError,
  ignoreBrowserFailure,
  updateWordSyncStatusCounts,
  type WordSyncBrowserApi,
  type WordSyncCoordinatorOptions,
  type PendingKind,
  type PendingSyncRequest,
  type PreparePendingKind,
} from "./word-sync-coordinator-support.js";
import {
  ensureWordSyncDailyAlarm,
  isWordSyncDailyPollTime,
  scheduleNextWordSyncDailyAlarm,
  WORD_SYNC_DAILY_ALARM,
} from "./word-sync-daily-alarm.js";
import {
  wordSyncCountsPresentation,
  wordSyncFailurePresentation,
  wordSyncStatusPresentation,
} from "./word-sync-presentation.js";
import {
  createWordSyncDiscardAllUnresolvedRequest,
  createWordSyncDiscardUnresolvedRequest,
  createWordSyncListUnresolvedRequest,
  createWordSyncPollRequest,
  createWordSyncPrepareBatchRequest,
  createWordSyncRequeueUnresolvedRequest,
  createWordSyncResolveBatchRequest,
  createWordSyncStatusRequest,
} from "./word-sync-request-factory.js";

export const SHANBAY_COLLECTION_URL = "https://web.shanbay.com/wordsweb/#/collection";
export const WORD_SYNC_CONTINUE_ALARM = "huayi-word-sync-continue";
export { WORD_SYNC_DAILY_ALARM };

export type {
  WordSyncBrowserApi,
  WordSyncCoordinatorOptions,
} from "./word-sync-coordinator-support.js";
export class WordSyncCoordinator {
  private readonly browser: WordSyncBrowserApi;
  private readonly createRequestId: () => string;
  private readonly pending = new Map<string, PendingSyncRequest>();
  private readonly now: () => Date;
  private readonly removeDisconnectListener: () => void;
  private readonly removeEventListener: () => void;
  private readonly timeoutMs: number;
  private readonly transport: NativeTransport;
  private lastStatus: WordSyncStatusEvent | null = null;
  constructor(options: WordSyncCoordinatorOptions) {
    this.browser = options.browser;
    this.createRequestId = options.createRequestId ?? (() => `sync-${crypto.randomUUID()}`);
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_WORD_SYNC_TIMEOUT_MS;
    this.transport = options.transport;
    this.removeEventListener = this.transport.onEvent((event) => this.handleEvent(event));
    this.removeDisconnectListener = this.transport.onDisconnect((disconnect) =>
      this.handleDisconnect(disconnect),
    );
  }
  initialize(): void {
    void ensureWordSyncDailyAlarm(this.browser, this.now());
    this.requestStatus();
  }
  handleAlarm(name: string): void {
    if (name === WORD_SYNC_DAILY_ALARM) {
      scheduleNextWordSyncDailyAlarm(this.browser, this.now());
      this.poll();
      return;
    }
    if (name === WORD_SYNC_CONTINUE_ALARM) this.poll();
  }
  handleActionClick(): void {
    this.prepare("action-prepare");
  }
  handleStartup(): void {
    this.requestStatus();
  }
  handlePageReady(tabId: number): void {
    this.prepare("tab-prepare", tabId);
  }
  resolveBatch(tabId: number, batchId: string, rejectedTargets: readonly string[]): void {
    const request = createWordSyncResolveBatchRequest(
      this.createRequestId(),
      batchId,
      rejectedTargets,
    );
    this.send(request, "resolve", tabId);
  }
  listUnresolved(tabId: number, offset: number): void {
    const request = createWordSyncListUnresolvedRequest(this.createRequestId(), offset);
    this.send(request, "list-unresolved", tabId);
  }
  requeueUnresolved(tabId: number, items: WordSyncRequeueUnresolvedRequest["items"]): void {
    const request = createWordSyncRequeueUnresolvedRequest(this.createRequestId(), items);
    this.send(request, "requeue-unresolved", tabId);
  }
  discardUnresolved(tabId: number, sourceWords: readonly string[]): void {
    const request = createWordSyncDiscardUnresolvedRequest(this.createRequestId(), sourceWords);
    this.send(request, "discard-unresolved", tabId);
  }
  discardAllUnresolved(tabId: number): void {
    const request = createWordSyncDiscardAllUnresolvedRequest(this.createRequestId());
    this.send(request, "discard-all-unresolved", tabId);
  }
  dispose(): void {
    this.removeEventListener();
    this.removeDisconnectListener();
    for (const pending of this.pending.values()) clearTimeout(pending.timeoutId);
    this.pending.clear();
  }
  private requestStatus(): void {
    if (this.hasPending("status")) return;
    this.send(createWordSyncStatusRequest(this.createRequestId()), "status");
  }
  private poll(resumePrepareKind?: PreparePendingKind, tabId?: number): void {
    if (attachPrepareToPendingPoll(this.pending.values(), resumePrepareKind, tabId)) return;
    this.send(createWordSyncPollRequest(this.createRequestId()), "poll", tabId, resumePrepareKind);
  }
  private prepare(kind: PreparePendingKind, tabId?: number): void {
    if (this.hasPending(kind)) return;
    this.send(createWordSyncPrepareBatchRequest(this.createRequestId()), kind, tabId);
  }
  private send(
    request: WordSyncRequest,
    kind: PendingKind,
    tabId?: number,
    resumePrepareKind?: PreparePendingKind,
  ): void {
    const timeoutId = setTimeout(() => this.handleTimeout(request.requestId), this.timeoutMs);
    const pending: PendingSyncRequest = {
      kind,
      request,
      timeoutId,
      ...(resumePrepareKind === undefined ? {} : { resumePrepareKind }),
      ...(tabId === undefined ? {} : { tabId }),
    };
    this.pending.set(request.requestId, pending);
    try {
      this.transport.send(request);
    } catch {
      this.finish(pending);
      this.handleFailure(pending, hostUnavailableError({ reason: "host-unavailable" }));
    }
  }
  private hasPending(kind: PendingKind): boolean {
    return [...this.pending.values()].some((pending) => pending.kind === kind);
  }
  private handleEvent(event: HostEvent): void {
    const pending = this.pending.get(event.requestId);
    if (pending === undefined) return;
    if (event.type === "error") {
      this.finish(pending);
      this.handleFailure(pending, event.error);
      this.recoverAfterPollFailure(pending, event.error);
      return;
    }
    if (event.type === "word-sync-status" && acceptsWordSyncStatus(pending.kind)) {
      this.finish(pending);
      this.handleStatus(pending, event);
      return;
    }
    if (
      event.type === "word-sync-batch" &&
      (pending.kind === "action-prepare" || pending.kind === "tab-prepare")
    ) {
      this.finish(pending);
      this.handleBatch(pending, event);
      return;
    }
    if (event.type === "word-sync-batch-resolved" && pending.kind === "resolve") {
      this.finish(pending);
      void this.handleResolved(pending, event);
      return;
    }
    if (event.type === "word-sync-unresolved-list" && pending.kind === "list-unresolved") {
      this.finish(pending);
      this.handleUnresolvedList(pending, event);
      return;
    }
    if (event.type === "word-sync-unresolved-requeued" && pending.kind === "requeue-unresolved") {
      this.finish(pending);
      void this.handleUnresolvedRequeued(pending, event);
      return;
    }
    if (
      event.type === "word-sync-unresolved-discarded" &&
      (pending.kind === "discard-unresolved" || pending.kind === "discard-all-unresolved")
    ) {
      this.finish(pending);
      void this.handleUnresolvedDiscarded(pending, event);
      return;
    }
    this.finish(pending);
    this.handleFailure(pending, {
      code: "INVALID_RESPONSE",
      message: "本机服务返回了与生词同步请求不匹配的数据。",
      retryable: false,
    });
  }
  private handleStatus(pending: PendingSyncRequest, event: WordSyncStatusEvent): void {
    this.lastStatus = event;
    this.applyPresentation(wordSyncStatusPresentation(event));
    if (
      (pending.kind === "action-prepare" || pending.kind === "tab-prepare") &&
      (event.pollDue || event.scanInProgress)
    ) {
      this.poll(pending.kind, pending.tabId);
      return;
    }
    if (pending.kind === "poll" && pending.resumePrepareKind !== undefined) {
      if (event.scanInProgress) {
        this.poll(pending.resumePrepareKind, pending.tabId);
      } else {
        this.prepare(pending.resumePrepareKind, pending.tabId);
      }
      return;
    }
    if (event.scanInProgress) {
      this.browser.createAlarm(WORD_SYNC_CONTINUE_ALARM, { delayInMinutes: 1 });
    }
    if (
      pending.kind === "status" &&
      event.pollDue &&
      (event.scanInProgress || isWordSyncDailyPollTime(this.now()))
    ) {
      this.poll();
    }
    if (pending.kind === "action-prepare" && event.unresolvedCount > 0) {
      ignoreBrowserFailure(this.browser.createTab(SHANBAY_COLLECTION_URL));
    }
    if (pending.kind === "tab-prepare" && pending.tabId !== undefined) {
      ignoreBrowserFailure(
        this.browser.sendToTab(pending.tabId, { event, type: "SHANBAY_SYNC_STATUS" }),
      );
      if (event.pendingCount === 0 && event.unresolvedCount > 0) {
        this.listUnresolved(pending.tabId, 0);
      }
    }
  }
  private handleBatch(pending: PendingSyncRequest, event: WordSyncBatchEvent): void {
    const batchSourceCount = event.items.reduce(
      (total, item) => total + item.sourceWords.length,
      0,
    );
    const totalPending = batchSourceCount + event.pendingAfterBatch;
    this.applyPresentation(
      wordSyncCountsPresentation(totalPending, this.lastStatus?.unresolvedCount ?? 0),
    );
    if (pending.kind === "action-prepare") {
      ignoreBrowserFailure(this.browser.createTab(SHANBAY_COLLECTION_URL));
      return;
    }
    if (pending.tabId !== undefined) {
      ignoreBrowserFailure(
        this.browser.sendToTab(pending.tabId, { event, type: "SHANBAY_SYNC_BATCH" }),
      );
    }
  }
  private async handleResolved(
    pending: PendingSyncRequest,
    event: WordSyncBatchResolvedEvent,
  ): Promise<void> {
    await this.handleDurableQueueUpdate(pending, event, {
      event,
      type: "SHANBAY_SYNC_RESOLVED",
    });
  }
  private handleUnresolvedList(
    pending: PendingSyncRequest,
    event: WordSyncUnresolvedListEvent,
  ): void {
    if (pending.tabId === undefined) return;
    ignoreBrowserFailure(
      this.browser.sendToTab(pending.tabId, {
        event,
        type: "SHANBAY_SYNC_UNRESOLVED",
      }),
    );
  }
  private async handleUnresolvedRequeued(
    pending: PendingSyncRequest,
    event: WordSyncUnresolvedRequeuedEvent,
  ): Promise<void> {
    await this.handleDurableQueueUpdate(pending, event, {
      event,
      type: "SHANBAY_SYNC_REQUEUED",
    });
  }
  private async handleUnresolvedDiscarded(
    pending: PendingSyncRequest,
    event: WordSyncUnresolvedDiscardedEvent,
  ): Promise<void> {
    await this.handleDurableQueueUpdate(pending, event, {
      event,
      type: "SHANBAY_SYNC_DISCARDED",
    });
  }
  private async handleDurableQueueUpdate(
    pending: PendingSyncRequest,
    counts: { pendingCount: number; unresolvedCount: number },
    message: ShanbayBackgroundMessage,
  ): Promise<void> {
    this.lastStatus = updateWordSyncStatusCounts(
      this.lastStatus,
      counts.pendingCount,
      counts.unresolvedCount,
    );
    this.applyPresentation(wordSyncCountsPresentation(counts.pendingCount, counts.unresolvedCount));
    if (pending.tabId === undefined) return;
    await this.sendToTab(pending.tabId, message);
    if (counts.pendingCount > 0) this.prepare("tab-prepare", pending.tabId);
    else if (counts.unresolvedCount > 0) this.listUnresolved(pending.tabId, 0);
  }
  private applyPresentation(presentation: { badge: string; title: string }): void {
    ignoreBrowserFailure(this.browser.setBadgeText(presentation.badge));
    ignoreBrowserFailure(this.browser.setTitle(presentation.title));
  }
  private async sendToTab(tabId: number, message: ShanbayBackgroundMessage): Promise<void> {
    try {
      await this.browser.sendToTab(tabId, message);
    } catch {
      // The Host result is already durable. Reopening the page restores it.
    }
  }
  private handleTimeout(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    try {
      this.transport.send({
        requestId: this.createRequestId(),
        schemaVersion: SCHEMA_VERSION,
        targetRequestId: requestId,
        type: "cancel",
      });
    } catch {
      // The local timeout still completes when the Native port is already unavailable.
    }
    this.finish(pending);
    const error: AnalysisError = {
      code: "TIMEOUT",
      message: "生词同步请求超时，请重试。",
      retryable: true,
    };
    this.handleFailure(pending, error);
    this.recoverAfterPollFailure(pending, error);
  }
  private handleDisconnect(disconnect: NativeDisconnect): void {
    const error = hostUnavailableError(disconnect);
    const pendingRequests = [...this.pending.values()];
    for (const pending of pendingRequests) this.finish(pending);
    for (const pending of pendingRequests) {
      this.handleFailure(pending, error);
      this.recoverAfterPollFailure(pending, error);
    }
  }
  private handleFailure(pending: PendingSyncRequest, error: AnalysisError): void {
    this.applyPresentation(wordSyncFailurePresentation(this.lastStatus, error));
    if (pending.tabId !== undefined) {
      ignoreBrowserFailure(
        this.browser.sendToTab(pending.tabId, { error, type: "SHANBAY_SYNC_ERROR" }),
      );
    }
  }
  private recoverAfterPollFailure(pending: PendingSyncRequest, error: AnalysisError): void {
    if (pending.kind !== "poll") return;
    if (error.retryable) {
      this.browser.createAlarm(WORD_SYNC_CONTINUE_ALARM, { delayInMinutes: 1 });
    }
    this.requestStatus();
  }
  private finish(pending: PendingSyncRequest): void {
    clearTimeout(pending.timeoutId);
    this.pending.delete(pending.request.requestId);
  }
}
