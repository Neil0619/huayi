import type { WordSyncBatchEvent } from "@huayi/protocol";

import {
  findBatchTextarea,
  findUniqueByText,
  normalizedText,
  normalizeTextareaValue,
} from "./shanbay-page-adapter.js";

type BrowserTimer = number;
type BrowserSetTimeout = (handler: () => void, timeout: number) => BrowserTimer;

const PREFILL_STEP_TIMEOUT_MS = 5_000;

export interface ShanbayBatchPrefillerOptions {
  document: Document;
  renderMessage(message: string): void;
  setTimer: BrowserSetTimeout;
}

export class ShanbayBatchPrefiller {
  private batch: WordSyncBatchEvent | null = null;
  private readonly document: Document;
  private readonly renderMessage: ShanbayBatchPrefillerOptions["renderMessage"];
  private replaceableTextarea: HTMLTextAreaElement | null = null;
  private replaceableValue: string | null = null;
  private stage: "dialog" | "upload" | null = null;
  private readonly setTimer: BrowserSetTimeout;
  private timer: BrowserTimer | null = null;

  constructor(options: ShanbayBatchPrefillerOptions) {
    this.document = options.document;
    this.renderMessage = options.renderMessage;
    this.setTimer = options.setTimer;
  }

  authorizeRejectedReplacement(textarea: HTMLTextAreaElement, targets: readonly string[]): void {
    this.replaceableTextarea = textarea;
    this.replaceableValue = normalizeTextareaValue(targets.join("\n"));
  }

  clearStage(): void {
    this.stage = null;
    if (this.timer === null) return;
    const windowRef = this.document.defaultView;
    if (windowRef === null) globalThis.clearTimeout(this.timer);
    else windowRef.clearTimeout(this.timer);
    this.timer = null;
  }

  continue(): void {
    if (this.stage === null || this.batch === null) return;
    if (this.stage === "upload") {
      const uploadButton = findUniqueByText(this.document, "批量上传");
      if (uploadButton === null) return;
      this.clearStage();
      this.stage = "dialog";
      this.renderMessage("正在打开扇贝批量上传窗口……");
      uploadButton.click();
      this.continue();
      if (this.stage === "dialog") {
        this.timer = this.setTimer(() => {
          this.timer = null;
          if (this.stage !== "dialog") return;
          this.stage = null;
          this.renderMessage("未找到扇贝批量输入框；本批仍保留在待同步队列。");
        }, PREFILL_STEP_TIMEOUT_MS);
      }
      return;
    }
    const textarea = findBatchTextarea(this.document);
    if (textarea === null) return;
    this.clearStage();
    this.fillTextarea(textarea, this.batch);
  }

  destroy(): void {
    this.clearStage();
    this.replaceableTextarea = null;
    this.replaceableValue = null;
    this.batch = null;
  }

  handleBeforeInput(event: Event): void {
    if (event.target !== this.replaceableTextarea) return;
    this.replaceableTextarea = null;
    this.replaceableValue = null;
  }

  prefill(batch: WordSyncBatchEvent): void {
    this.batch = batch;
    const textarea = findBatchTextarea(this.document);
    if (textarea !== null) {
      this.fillTextarea(textarea, batch);
      return;
    }
    if (normalizedText(this.document.body).includes("登录")) {
      this.renderMessage("请先登录扇贝，登录完成后重新点击扩展角标。");
      return;
    }
    this.stage = "upload";
    this.renderMessage("正在等待扇贝批量上传控件……");
    this.continue();
    if (this.stage === "upload") {
      this.timer = this.setTimer(() => {
        this.timer = null;
        if (this.stage !== "upload") return;
        this.stage = null;
        this.renderMessage("扇贝页面结构已变化，未执行预填；本批仍保留在待同步队列。");
      }, PREFILL_STEP_TIMEOUT_MS);
    }
  }

  private fillTextarea(textarea: HTMLTextAreaElement, batch: WordSyncBatchEvent): void {
    const expected = batch.items.map((item) => item.targetWord).join("\n");
    const mayReplaceRejectedWords =
      textarea === this.replaceableTextarea &&
      this.replaceableValue !== null &&
      normalizeTextareaValue(textarea.value) === this.replaceableValue;
    if (
      textarea.value.trim().length > 0 &&
      textarea.value !== expected &&
      !mayReplaceRejectedWords
    ) {
      this.replaceableTextarea = null;
      this.replaceableValue = null;
      this.renderMessage("批量输入框已有内容，语见没有覆盖；本批仍保留在待同步队列。");
      return;
    }
    if (textarea.value !== expected) {
      const setter = Object.getOwnPropertyDescriptor(
        this.document.defaultView?.HTMLTextAreaElement.prototype ?? Object.prototype,
        "value",
      )?.set;
      setter?.call(textarea, expected);
      if (textarea.value !== expected) textarea.value = expected;
      const eventConstructor = this.document.defaultView?.Event ?? Event;
      textarea.dispatchEvent(new eventConstructor("input", { bubbles: true }));
      textarea.dispatchEvent(new eventConstructor("change", { bubbles: true }));
    }
    this.replaceableTextarea = null;
    this.replaceableValue = null;
    textarea.focus();
    const mappings = batch.items
      .filter((item) => item.attempt !== "original")
      .flatMap((item) =>
        item.sourceWords
          .filter((sourceWord) => sourceWord !== item.targetWord)
          .map((sourceWord) => `${sourceWord} → ${item.targetWord}`),
      );
    const mappingText =
      mappings.length === 0
        ? ""
        : ` 词形还原：${mappings.slice(0, 5).join("、")}${mappings.length > 5 ? "……" : ""}。`;
    this.renderMessage(
      `已预填 ${batch.items.length} 个目标词，请检查后点击扇贝的“批量添加”。${mappingText}`,
    );
  }
}
