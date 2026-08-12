import {
  STORE_MESSAGE_VERSION,
  type ShanbayBatch,
  type StoreWordbookRequest,
} from "@huayi/store-domain";

import {
  compactText,
  feedbackHasExplicitFailure,
  feedbackHasExplicitSuccess,
  findBatchTextarea,
  findUniqueButton,
  normalizeBatchText,
  readRejectedWords,
  resultFeedback,
} from "./shanbay-page-adapter.js";

interface ShanbaySyncControllerOptions {
  readonly acceptsUserGesture?: (event: Event) => boolean;
  readonly document: Document;
  readonly sendMessage: (message: StoreWordbookRequest) => Promise<unknown>;
}

class ShanbayAccessError extends Error {
  constructor(readonly code: "consent-required" | "recipient-disabled") {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim() === value && value.length >= 1 && value.length <= 200
  );
}

function parseBatchResponse(value: unknown): ShanbayBatch | null {
  if (
    isRecord(value) &&
    exactKeys(value, ["code", "messageVersion", "type"]) &&
    value.messageVersion === STORE_MESSAGE_VERSION &&
    value.type === "store/wordbook-error" &&
    (value.code === "consent-required" || value.code === "recipient-disabled")
  ) {
    throw new ShanbayAccessError(value.code);
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, ["batch", "messageVersion", "type"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/shanbay-batch"
  ) {
    throw new TypeError("Invalid Shanbay batch response.");
  }
  if (value.batch === null) return null;
  if (
    !isRecord(value.batch) ||
    !exactKeys(value.batch, ["items", "token"]) ||
    !boundedId(value.batch.token) ||
    !Array.isArray(value.batch.items) ||
    value.batch.items.length < 1 ||
    value.batch.items.length > 100
  ) {
    throw new TypeError("Invalid Shanbay batch response.");
  }
  const items = value.batch.items.map((item) => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ["entryId", "outboxId"]) ||
      !boundedId(item.entryId) ||
      !boundedId(item.outboxId)
    ) {
      throw new TypeError("Invalid Shanbay batch response.");
    }
    return { entryId: item.entryId, outboxId: item.outboxId };
  });
  return { items, token: value.batch.token };
}

function parseResolveResponse(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["accepted", "messageVersion", "type"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/shanbay-resolved" ||
    typeof value.accepted !== "boolean"
  ) {
    throw new TypeError("Invalid Shanbay resolve response.");
  }
  return value.accepted;
}

export function isExactShanbayCollectionPage(
  location: Pick<URL, "hash" | "origin" | "pathname" | "search">,
): boolean {
  return (
    location.origin === "https://web.shanbay.com" &&
    location.pathname === "/wordsweb/" &&
    location.search === "" &&
    location.hash === "#/collection"
  );
}

export class ShanbaySyncController {
  private readonly acceptsUserGesture: (event: Event) => boolean;
  private activeBatch: ShanbayBatch | null = null;
  private awaitingResult = false;
  private generation = 0;
  private observer: MutationObserver | null = null;
  private resultBaseline = new Set<string>();
  private resolving = false;

  constructor(private readonly options: ShanbaySyncControllerOptions) {
    this.acceptsUserGesture = options.acceptsUserGesture ?? ((event) => event.isTrusted);
  }

  async start(): Promise<void> {
    if (this.observer !== null) return;
    const generation = ++this.generation;
    const observerConstructor =
      this.options.document.defaultView?.MutationObserver ?? MutationObserver;
    this.observer = new observerConstructor(() => {
      this.continuePrefill();
      void this.inspectResult();
    });
    this.observer.observe(this.options.document.documentElement, {
      childList: true,
      subtree: true,
    });
    this.options.document.addEventListener("click", this.onClick, true);
    try {
      const batch = parseBatchResponse(
        await this.options.sendMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/shanbay-page-ready",
        }),
      );
      if (generation !== this.generation || this.observer === null) return;
      this.activeBatch = batch;
      if (batch === null) {
        this.render("没有待同步到扇贝的生词。");
        return;
      }
      this.render(`正在准备 ${batch.items.length} 个生词…`);
      this.continuePrefill();
    } catch (error) {
      if (generation !== this.generation || this.observer === null) return;
      this.render(
        error instanceof ShanbayAccessError
          ? error.code === "consent-required"
            ? "扇贝导出尚未同意；请在划译设置中阅读数据说明并授权。"
            : "扇贝导出已停用；请在划译设置中启用后再打开此页面。"
          : "与扩展后台通信失败；待同步状态没有修改。",
      );
    }
  }

  stop(): void {
    this.generation += 1;
    this.observer?.disconnect();
    this.observer = null;
    this.activeBatch = null;
    this.awaitingResult = false;
    this.resultBaseline.clear();
    this.options.document.removeEventListener("click", this.onClick, true);
    this.options.document.querySelector("[data-huayi-store-shanbay]")?.remove();
  }

  private continuePrefill(): void {
    const batch = this.activeBatch;
    if (batch === null) return;
    const textarea = findBatchTextarea(this.options.document);
    if (textarea === null) {
      const upload = findUniqueButton(this.options.document, "批量上传");
      if (upload !== null && upload.dataset.huayiStoreOpened !== "true") {
        upload.dataset.huayiStoreOpened = "true";
        upload.click();
        this.render("正在打开扇贝批量上传窗口…");
      }
      return;
    }
    const expected = batch.items.map((item) => item.entryId).join("\n");
    if (
      textarea.value.trim().length > 0 &&
      normalizeBatchText(textarea.value) !== normalizeBatchText(expected)
    ) {
      this.render("批量输入框已有内容，划译没有覆盖；本批仍保留在待同步队列。");
      return;
    }
    if (textarea.value !== expected) {
      textarea.value = expected;
      const eventConstructor = this.options.document.defaultView?.Event ?? Event;
      textarea.dispatchEvent(new eventConstructor("input", { bubbles: true }));
      textarea.dispatchEvent(new eventConstructor("change", { bubbles: true }));
    }
    textarea.focus();
    this.render(`已预填 ${batch.items.length} 个生词，请检查后亲自点击扇贝“批量添加”。`);
  }

  private readonly onClick = (event: Event): void => {
    if (this.activeBatch === null || this.resolving || !this.acceptsUserGesture(event)) return;
    const elementConstructor = this.options.document.defaultView?.Element ?? Element;
    if (!(event.target instanceof elementConstructor)) return;
    const button = event.target.closest<HTMLElement>('button, [role="button"]');
    if (button === null || compactText(button) !== "批量添加") return;
    const textarea = findBatchTextarea(this.options.document);
    const expected = this.activeBatch.items.map((item) => item.entryId).join("\n");
    if (textarea === null || normalizeBatchText(textarea.value) !== normalizeBatchText(expected)) {
      this.render("批量输入内容与当前批次不一致，划译不会确认结果。");
      return;
    }
    this.awaitingResult = true;
    this.resultBaseline = new Set(resultFeedback(this.options.document));
  };

  private async inspectResult(): Promise<void> {
    const batch = this.activeBatch;
    if (!this.awaitingResult || this.resolving || batch === null) return;
    const currentFeedback = resultFeedback(this.options.document);
    const newFeedback = [...currentFeedback].filter((message) => !this.resultBaseline.has(message));
    if (newFeedback.length === 0) return;
    const words = batch.items.map((item) => item.entryId);
    const rejectedWords = readRejectedWords(this.options.document, words);
    if (rejectedWords !== null && feedbackHasExplicitFailure(newFeedback)) {
      const rejected = new Set(rejectedWords.map(normalizeBatchText));
      await this.resolve(
        batch.items
          .filter((item) => !rejected.has(normalizeBatchText(item.entryId)))
          .map((item) => item.outboxId),
        batch.items
          .filter((item) => rejected.has(normalizeBatchText(item.entryId)))
          .map((item) => item.outboxId),
      );
      return;
    }
    if (feedbackHasExplicitSuccess(newFeedback, batch.items.length)) {
      await this.resolve(
        batch.items.map((item) => item.outboxId),
        [],
      );
    }
  }

  private async resolve(confirmedOutboxIds: string[], failedOutboxIds: string[]): Promise<void> {
    const batch = this.activeBatch;
    if (batch === null || this.resolving) return;
    this.resolving = true;
    try {
      const accepted = parseResolveResponse(
        await this.options.sendMessage({
          batchToken: batch.token,
          confirmedOutboxIds,
          failedOutboxIds,
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/shanbay-resolve",
        }),
      );
      if (!accepted) throw new Error("Receipt rejected.");
      this.activeBatch = null;
      this.awaitingResult = false;
      this.resultBaseline.clear();
      this.render(
        failedOutboxIds.length === 0
          ? "本批已确认完成。"
          : `已确认 ${confirmedOutboxIds.length} 个；${failedOutboxIds.length} 个失败词已重新排队。`,
      );
    } catch {
      this.awaitingResult = false;
      this.resultBaseline.clear();
      this.render("批次确认失败；本批仍保留，请稍后重试。");
    } finally {
      this.resolving = false;
    }
  }

  private render(message: string): void {
    let status = this.options.document.querySelector<HTMLElement>("[data-huayi-store-shanbay]");
    if (status === null) {
      status = this.options.document.createElement("aside");
      status.dataset.huayiStoreShanbay = "";
      status.setAttribute("role", "status");
      Object.assign(status.style, {
        background: "#17332d",
        borderRadius: "10px",
        bottom: "16px",
        color: "white",
        font: "14px/1.5 system-ui, sans-serif",
        maxWidth: "420px",
        padding: "12px 16px",
        position: "fixed",
        right: "16px",
        zIndex: "2147483647",
      });
      this.options.document.body.append(status);
    }
    if (status.textContent !== message) status.textContent = message;
  }
}
