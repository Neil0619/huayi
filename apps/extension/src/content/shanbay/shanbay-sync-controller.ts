import {
  analysisErrorSchema,
  wordSyncBatchEventSchema,
  wordSyncBatchResolvedEventSchema,
  wordSyncStatusEventSchema,
  wordSyncUnresolvedDiscardedEventSchema,
  wordSyncUnresolvedListEventSchema,
  wordSyncUnresolvedRequeuedEventSchema,
} from "@huayi/protocol";
import type { WordSyncBatchEvent, WordSyncUnresolvedListEvent } from "@huayi/protocol";

import type { ShanbayBackgroundMessage, ShanbayCommand } from "../../shared/extension-messages.js";
import {
  batchFailureSignature,
  findBatchTextarea,
  isExplicitFailure,
  isExplicitSuccess,
  normalizedText,
  normalizeTextareaValue,
  pageHasFullCountCompletion,
  readRejectedBatchResult,
  visibleFeedback,
} from "./shanbay-page-adapter.js";
import { ShanbayBatchPrefiller } from "./shanbay-batch-prefiller.js";
import { ShanbaySyncBanner } from "./shanbay-sync-banner.js";
import {
  createBrowserSetTimeout,
  isRecord,
  MANUAL_CONFIRMATION_DELAY_MS,
  type BrowserSetTimeout,
  type BrowserTimer,
  type ShanbaySyncControllerOptions,
} from "./shanbay-sync-controller-support.js";

export type { ShanbaySyncControllerOptions } from "./shanbay-sync-controller-support.js";
export { isShanbayCollectionPage } from "./shanbay-sync-controller-support.js";

export class ShanbaySyncController {
  private activeBatch: WordSyncBatchEvent | null = null;
  private readonly banner: ShanbaySyncBanner;
  private readonly document: Document;
  private readonly observer: MutationObserver;
  private readonly prefiller: ShanbayBatchPrefiller;
  private readonly sendMessage: ShanbaySyncControllerOptions["sendMessage"];
  private readonly setTimer: BrowserSetTimeout;
  private confirmationTimer: BrowserTimer | null = null;
  private failureBeforeSubmit: string | null = null;
  private feedbackBeforeSubmit = new Set<string>();
  private awaitingResult = false;
  private confirming = false;
  private submittedTextarea: HTMLTextAreaElement | null = null;
  private submittedValue: string | null = null;
  private submittedValueWasEdited = false;

  constructor(options: ShanbaySyncControllerOptions) {
    this.document = options.document;
    this.banner = new ShanbaySyncBanner(options.document);
    this.sendMessage = options.sendMessage;
    const scheduleTimer = options.setTimeout;
    this.setTimer =
      scheduleTimer === undefined
        ? createBrowserSetTimeout(this.document)
        : (handler, timeout) => scheduleTimer(handler, timeout);
    this.prefiller = new ShanbayBatchPrefiller({
      document: this.document,
      renderMessage: (message) => this.renderBanner(message, false),
      setTimer: this.setTimer,
    });
    const mutationObserverConstructor =
      options.document.defaultView?.MutationObserver ?? MutationObserver;
    this.observer = new mutationObserverConstructor(() => {
      this.prefiller.continue();
      this.inspectFeedback();
    });
    this.observer.observe(options.document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    options.document.addEventListener("click", this.handleDocumentClick, true);
    options.document.addEventListener("beforeinput", this.handleDocumentBeforeInput, true);
    this.deliver({ type: "SHANBAY_PAGE_READY" });
  }

  handleMessage(value: unknown): boolean {
    if (!isRecord(value) || typeof value.type !== "string") return false;
    switch (value.type) {
      case "SHANBAY_SYNC_BATCH": {
        const parsed = wordSyncBatchEventSchema.safeParse(value.event);
        if (!parsed.success) return false;
        this.activeBatch = parsed.data;
        this.confirming = false;
        this.awaitingResult = false;
        this.failureBeforeSubmit = batchFailureSignature(this.document);
        this.feedbackBeforeSubmit = new Set(visibleFeedback(this.document));
        this.resetSubmittedValue();
        this.clearConfirmationTimer();
        this.prefiller.clearStage();
        this.prefiller.prefill(parsed.data);
        return true;
      }
      case "SHANBAY_SYNC_RESOLVED": {
        const parsed = wordSyncBatchResolvedEventSchema.safeParse(value.event);
        if (!parsed.success) return false;
        this.activeBatch = null;
        this.confirming = false;
        this.awaitingResult = false;
        this.feedbackBeforeSubmit.clear();
        this.resetSubmittedValue();
        this.clearConfirmationTimer();
        this.prefiller.clearStage();
        this.renderBanner(
          parsed.data.pendingCount === 0 && parsed.data.unresolvedCount === 0
            ? "生词同步完成。"
            : parsed.data.pendingCount > 0
              ? "本批结果已确认，正在准备下一批……"
              : `同步队列已处理完，仍有 ${parsed.data.unresolvedCount} 个词需要人工处理。`,
          false,
        );
        return true;
      }
      case "SHANBAY_SYNC_STATUS": {
        const parsed = wordSyncStatusEventSchema.safeParse(value.event);
        if (!parsed.success) return false;
        if (parsed.data.pendingCount === 0) {
          this.renderBanner(
            parsed.data.unresolvedCount > 0
              ? `没有待同步批次，仍有 ${parsed.data.unresolvedCount} 个词需要人工处理。`
              : parsed.data.historyComplete
                ? "没有待同步生词。"
                : "欧路历史生词仍在读取中。",
            false,
          );
        }
        return true;
      }
      case "SHANBAY_SYNC_UNRESOLVED": {
        const parsed = wordSyncUnresolvedListEventSchema.safeParse(value.event);
        if (!parsed.success) return false;
        this.renderUnresolved(parsed.data);
        return true;
      }
      case "SHANBAY_SYNC_REQUEUED": {
        const parsed = wordSyncUnresolvedRequeuedEventSchema.safeParse(value.event);
        if (!parsed.success) return false;
        this.renderBanner(
          parsed.data.requeuedCount > 0
            ? `已将 ${parsed.data.requeuedCount} 个人工替代词重新加入同步队列。`
            : "所选替代词已由扇贝中的现有词覆盖。",
          false,
        );
        return true;
      }
      case "SHANBAY_SYNC_DISCARDED": {
        const parsed = wordSyncUnresolvedDiscardedEventSchema.safeParse(value.event);
        if (!parsed.success) return false;
        this.renderBanner(
          parsed.data.unresolvedCount === 0
            ? `已放弃 ${parsed.data.discardedCount} 个词；没有需要人工处理的词。`
            : `已放弃 ${parsed.data.discardedCount} 个词，正在刷新剩余列表……`,
          false,
        );
        return true;
      }
      case "SHANBAY_SYNC_ERROR": {
        const parsed = analysisErrorSchema.safeParse(value.error);
        if (!parsed.success) return false;
        this.confirming = false;
        this.awaitingResult = false;
        this.resetSubmittedValue();
        this.clearConfirmationTimer();
        this.renderBanner(parsed.data.message, false);
        return true;
      }
      default:
        return false;
    }
  }

  destroy(): void {
    this.clearConfirmationTimer();
    this.prefiller.destroy();
    this.observer.disconnect();
    this.document.removeEventListener("click", this.handleDocumentClick, true);
    this.document.removeEventListener("beforeinput", this.handleDocumentBeforeInput, true);
    this.banner.destroy();
  }

  private readonly handleDocumentBeforeInput = (event: Event): void => {
    if (
      this.awaitingResult &&
      (event.target === this.submittedTextarea || event.target === findBatchTextarea(this.document))
    ) {
      this.submittedValueWasEdited = true;
    }
    this.prefiller.handleBeforeInput(event);
  };

  private readonly handleDocumentClick = (event: Event): void => {
    if (this.activeBatch === null || this.confirming) return;
    const target = event.target;
    const elementConstructor = this.document.defaultView?.Element ?? Element;
    if (!(target instanceof elementConstructor)) return;
    const button = target.closest<HTMLElement>('button, [role="button"], input, a, div, span');
    if (button === null || normalizedText(button) !== "批量添加") return;
    const textarea = findBatchTextarea(this.document);
    const expected = this.activeBatch.items.map((item) => item.targetWord).join("\n");
    this.submittedTextarea = textarea;
    this.submittedValue =
      textarea !== null &&
      normalizeTextareaValue(textarea.value) === normalizeTextareaValue(expected)
        ? normalizeTextareaValue(expected)
        : null;
    this.submittedValueWasEdited = false;
    this.feedbackBeforeSubmit = new Set(visibleFeedback(this.document));
    this.failureBeforeSubmit = batchFailureSignature(this.document);
    this.awaitingResult = true;
    this.clearConfirmationTimer();
    this.confirmationTimer = this.setTimer(() => {
      this.confirmationTimer = null;
      if (this.activeBatch !== null && !this.confirming) {
        this.renderBanner("扇贝没有返回明确的全部成功提示。请确认后再提交本批状态。", true);
      }
    }, MANUAL_CONFIRMATION_DELAY_MS);
  };

  private inspectFeedback(): void {
    if (this.activeBatch === null || this.confirming) return;
    if (!this.awaitingResult) return;
    const feedback = visibleFeedback(this.document).filter(
      (message) => !this.feedbackBeforeSubmit.has(message),
    );
    const failure = batchFailureSignature(this.document);
    const newFailure =
      feedback.some(isExplicitFailure) ||
      (failure !== null && failure !== this.failureBeforeSubmit);
    if (newFailure) {
      this.awaitingResult = false;
      this.clearConfirmationTimer();
      const batch = this.activeBatch;
      const rejected =
        batch === null ? null : readRejectedBatchResult(this.document, this.batchTargets(batch));
      if (rejected === null) {
        this.renderBanner(
          "扇贝返回了失败提示，但失败数量与输入框残留词无法验证；本批已完整保留。",
          false,
        );
        return;
      }
      this.prefiller.authorizeRejectedReplacement(rejected.textarea, rejected.rejectedTargets);
      this.resolveActiveBatch(rejected.rejectedTargets);
      return;
    }
    const currentTextarea = findBatchTextarea(this.document);
    const currentCompletion =
      this.submittedValue !== null &&
      !this.submittedValueWasEdited &&
      currentTextarea !== null &&
      normalizeTextareaValue(currentTextarea.value) === "" &&
      pageHasFullCountCompletion(this.document, this.activeBatch.items.length);
    if (feedback.some(isExplicitSuccess) || currentCompletion) this.resolveActiveBatch([]);
  }

  private resolveActiveBatch(rejectedTargets: string[]): void {
    const batch = this.activeBatch;
    if (batch === null || this.confirming) return;
    this.confirming = true;
    this.awaitingResult = false;
    this.clearConfirmationTimer();
    this.renderBanner(
      rejectedTargets.length === 0
        ? "扇贝已明确添加成功，正在确认本批……"
        : `扇贝拒绝了 ${rejectedTargets.length} 个目标词，正在确认成功词并尝试还原词形……`,
      false,
    );
    this.deliver(
      {
        batchId: batch.batchId,
        rejectedTargets,
        type: "RESOLVE_SHANBAY_BATCH",
      },
      () => {
        if (this.activeBatch?.batchId !== batch.batchId) return;
        this.confirming = false;
        this.renderBanner(
          "与扩展后台通信失败；本批仍保留。请重新点击扇贝的“批量添加”后重试。",
          false,
        );
      },
    );
  }

  private renderBanner(
    message: string,
    allowConfirm: boolean,
    confirmLabel = "确认已全部添加",
    keepLabel = "保留待同步",
  ): void {
    this.banner.render(
      message,
      allowConfirm
        ? {
            confirmLabel,
            keepLabel,
            onConfirm: () => this.resolveActiveBatch([]),
            onKeep: () => {
              this.awaitingResult = false;
              this.resetSubmittedValue();
              this.clearConfirmationTimer();
              this.renderBanner("本批已保留，稍后可重新点击扩展角标继续。", false);
            },
          }
        : undefined,
    );
  }

  private renderUnresolved(event: WordSyncUnresolvedListEvent): void {
    this.banner.renderUnresolved(
      `有 ${event.totalCount} 个词需要人工处理。可输入替代词重新入队，或放弃确认是错词的项目。`,
      {
        event,
        onDiscard: (sourceWords) => {
          this.deliver({ sourceWords, type: "DISCARD_SHANBAY_UNRESOLVED" });
        },
        onDiscardAll: () => {
          this.deliver({ type: "DISCARD_ALL_SHANBAY_UNRESOLVED" });
        },
        onPage: (offset) => {
          this.deliver({ offset, type: "LIST_SHANBAY_UNRESOLVED" });
        },
        onRequeue: (items) => {
          this.deliver({ items, type: "REQUEUE_SHANBAY_UNRESOLVED" });
        },
      },
    );
  }

  private deliver(message: ShanbayCommand, onFailure?: () => void): void {
    const handleFailure = (): void => {
      if (onFailure !== undefined) {
        onFailure();
        return;
      }
      this.renderBanner("与扩展后台通信失败；本机同步状态没有被修改。", false);
    };
    try {
      const delivery = this.sendMessage(message);
      if (delivery === undefined) return;
      void delivery.then((response) => {
        if (isRecord(response) && response.handled === false) handleFailure();
      }, handleFailure);
    } catch {
      handleFailure();
    }
  }

  private batchTargets(batch: WordSyncBatchEvent): string[] {
    return batch.items.map((item) => item.targetWord);
  }

  private clearConfirmationTimer(): void {
    if (this.confirmationTimer === null) return;
    const windowRef = this.document.defaultView;
    if (windowRef === null) globalThis.clearTimeout(this.confirmationTimer);
    else windowRef.clearTimeout(this.confirmationTimer);
    this.confirmationTimer = null;
  }

  private resetSubmittedValue(): void {
    this.submittedTextarea = null;
    this.submittedValue = null;
    this.submittedValueWasEdited = false;
  }
}

export function isShanbayBackgroundMessage(value: unknown): value is ShanbayBackgroundMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "SHANBAY_SYNC_BATCH":
      return wordSyncBatchEventSchema.safeParse(value.event).success;
    case "SHANBAY_SYNC_RESOLVED":
      return wordSyncBatchResolvedEventSchema.safeParse(value.event).success;
    case "SHANBAY_SYNC_STATUS":
      return wordSyncStatusEventSchema.safeParse(value.event).success;
    case "SHANBAY_SYNC_UNRESOLVED":
      return wordSyncUnresolvedListEventSchema.safeParse(value.event).success;
    case "SHANBAY_SYNC_REQUEUED":
      return wordSyncUnresolvedRequeuedEventSchema.safeParse(value.event).success;
    case "SHANBAY_SYNC_DISCARDED":
      return wordSyncUnresolvedDiscardedEventSchema.safeParse(value.event).success;
    case "SHANBAY_SYNC_ERROR":
      return analysisErrorSchema.safeParse(value.error).success;
    default:
      return false;
  }
}
