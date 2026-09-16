import {
  backfillPageResponseSchema,
  type BackfillPageBatch,
} from "../../backfill/backfill-messages.js";
import {
  batchScope,
  findBatchTextarea,
  findUniqueButton,
  normalizeBatchText,
  setBatchTextareaValue,
} from "./shanbay-page-adapter.js";
import { BackfillReviewPanel } from "./backfill-review-panel.js";
import { ShanbaySubmissionFeedback } from "./shanbay-submission-feedback.js";

export class BackfillPageController {
  private panel: BackfillReviewPanel | null = null;
  private batch: BackfillPageBatch | null = null;
  private observer: MutationObserver | null = null;
  private generation = 0;
  private awaiting = false;
  private resolving = false;
  private submission: ShanbaySubmissionFeedback | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private opening: HTMLElement | null = null;
  private loading = false;
  private activationPending = false;
  private reviewPending = false;
  private editedSinceSubmit = false;
  private userEditedInput: HTMLTextAreaElement | null = null;
  private replaceableInput: { input: HTMLTextAreaElement; value: string } | null = null;
  private writingInput = false;
  constructor(
    private readonly options: {
      document: Document;
      sendMessage: (message: unknown) => Promise<unknown>;
      acceptsUserGesture?: (event: Event) => boolean;
    },
  ) {}

  async start(): Promise<void> {
    if (this.observer) return;
    this.generation += 1;
    const observerConstructor =
      this.options.document.defaultView?.MutationObserver ?? MutationObserver;
    this.observer = new observerConstructor(() => {
      void this.inspect();
      this.prefill();
    });
    this.observer.observe(this.options.document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden", "aria-disabled", "disabled", "style"],
    });
    this.options.document.addEventListener("click", this.onClick, true);
    this.options.document.addEventListener("input", this.onInput, true);
    await this.activate();
  }
  async activate(): Promise<void> {
    if (!this.observer) return;
    if (this.batch) {
      this.prefill();
      return;
    }
    if (this.loading) {
      this.activationPending = true;
      return;
    }
    this.loading = true;
    const generation = this.generation;
    try {
      const response = backfillPageResponseSchema.parse(
        await this.options.sendMessage({ type: "store/backfill-page-ready" }),
      );
      if (generation !== this.generation || !this.observer) return;
      this.batch = response.accepted ? response.batch : null;
      if (!response.accepted) {
        this.panel?.destroy();
        this.panel = null;
      }
      if (!this.batch) {
        this.render(
          response.accepted
            ? response.review
              ? "需处理词在下方统一处理。"
              : "本次待回填词已处理完毕。需处理词在下方统一处理。"
            : "请从语见弹窗点击“打开扇贝回填”。",
        );
        if (response.accepted) void this.openReview();
        return;
      }
      this.opening = null;
      if (this.renewTimer) clearInterval(this.renewTimer);
      this.renewTimer = setInterval(() => {
        void this.renew();
      }, 60_000);
      if (response.review) await this.openReview();
      else this.prefill();
    } catch {
      if (generation === this.generation && this.observer)
        this.render("回填连接不可用，请回到语见弹窗检查。");
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        if (this.reviewPending) {
          this.reviewPending = false;
          void this.openReview();
        }
        if (this.activationPending) {
          this.activationPending = false;
          if (this.observer && !this.batch) void this.activate();
        }
      }
    }
  }
  async openReview(): Promise<void> {
    if (this.loading) {
      this.reviewPending = true;
      return;
    }
    if (this.observer) await this.getPanel().open();
  }
  stop(): void {
    if (this.awaiting && this.batch) void this.unknown();
    this.generation += 1;
    this.loading = false;
    this.activationPending = false;
    this.reviewPending = false;
    this.observer?.disconnect();
    this.observer = null;
    this.options.document.removeEventListener("click", this.onClick, true);
    this.options.document.removeEventListener("input", this.onInput, true);
    this.clearTimers();
    this.batch = null;
    this.awaiting = false;
    this.submission = null;
    this.userEditedInput = null;
    this.replaceableInput = null;
    this.panel?.destroy();
    this.panel = null;
    this.resolving = false;
  }
  private clearTimers(): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.resultTimer = null;
    this.renewTimer = null;
  }
  private prefill(): void {
    if (!this.batch || this.awaiting || this.resolving) return;
    const input = findBatchTextarea(this.options.document);
    if (!input) {
      const upload = findUniqueButton(this.options.document, "批量上传");
      if (upload && upload !== this.opening) {
        this.opening = upload;
        upload.click();
      }
      return;
    }
    const expected = this.batch.items.map((item) => item.headword).join("\n");
    const replaceable = this.replaceableInput;
    this.replaceableInput = null;
    const mayReplace = replaceable?.input === input && replaceable.value === input.value;
    if (
      (this.userEditedInput === input && input.value !== expected) ||
      (!mayReplace &&
        input.value.trim() &&
        normalizeBatchText(input.value) !== normalizeBatchText(expected))
    ) {
      this.render("语见保留了你对输入框的修改；请处理后再回填。");
      return;
    }
    if (input.value !== expected) {
      this.writingInput = true;
      try {
        setBatchTextareaValue(input, expected);
      } finally {
        this.writingInput = false;
      }
    }
    this.render(`已预填 ${this.batch.items.length} 个词，请检查后亲自点击扇贝“批量添加”。`);
  }
  private readonly onClick = (event: Event): void => {
    if (
      !this.batch ||
      this.awaiting ||
      this.resolving ||
      !(this.options.acceptsUserGesture?.(event) ?? event.isTrusted)
    )
      return;
    const elementConstructor = this.options.document.defaultView?.Element ?? Element;
    if (!(event.target instanceof elementConstructor)) return;
    const input = findBatchTextarea(this.options.document);
    if (!input) return;
    const button = findUniqueButton(this.options.document, "批量添加", batchScope(input));
    if (!button || !button.contains(event.target)) return;
    if (
      normalizeBatchText(input.value) !== this.batch.items.map((item) => item.headword).join("\n")
    ) {
      this.render("输入内容与本批不一致，语见不会确认结果。");
      return;
    }
    this.awaiting = true;
    this.editedSinceSubmit = false;
    this.userEditedInput = null;
    this.submission = new ShanbaySubmissionFeedback(input);
    this.render("已提交，正在等待扇贝返回本批结果，请勿重复点击。");
    this.resultTimer = setTimeout(() => {
      void this.unknown();
    }, 30_000);
  };
  private readonly onInput = (event: Event): void => {
    if (this.writingInput || !(this.options.acceptsUserGesture?.(event) ?? event.isTrusted)) return;
    const input = findBatchTextarea(this.options.document);
    if (!input || event.target !== input) return;
    this.userEditedInput = input;
    this.replaceableInput = null;
    if (this.awaiting || this.resolving) this.editedSinceSubmit = true;
  };
  private async inspect(): Promise<void> {
    const batch = this.batch;
    if (!batch || !this.awaiting || this.resolving) return;
    const receipt = this.submission?.read(
      batch.items.map((item) => item.headword),
      this.editedSinceSubmit,
    );
    if (!receipt) return;
    const failures = new Set(receipt.rejected);
    await this.resolve(
      batch.items.filter((item) => !failures.has(item.headword)).map((item) => item.alias),
      batch.items.filter((item) => failures.has(item.headword)).map((item) => item.alias),
    );
  }

  private async resolve(confirmedAliases: string[], rejectedAliases: string[]): Promise<void> {
    const batch = this.batch;
    if (!batch || this.resolving) return;
    const generation = this.generation;
    this.resolving = true;
    this.render("扇贝已返回结果，正在保存回填回执……");
    this.clearTimers();
    const input = findBatchTextarea(this.options.document);
    const previousInput = input?.value;
    try {
      const response = backfillPageResponseSchema.parse(
        await this.options.sendMessage({
          type: "store/backfill-resolve",
          batchAlias: batch.batchAlias,
          confirmedAliases,
          rejectedAliases,
        }),
      );
      if (!response.accepted) throw new Error("Unconfirmed receipt.");
      if (generation !== this.generation || !this.observer) return;
      this.batch = null;
      this.awaiting = false;
      this.submission = null;
      this.resolving = false;
      // The next batch may replace only unchanged text belonging to this confirmed submission.
      const current = findBatchTextarea(this.options.document);
      const oldWords = new Set(batch.items.map((item) => item.headword));
      const owned =
        previousInput !== undefined &&
        normalizeBatchText(previousInput)
          .split("\n")
          .every((word) => !word || oldWords.has(word));
      if (
        current &&
        current === input &&
        current.value === previousInput &&
        owned &&
        !this.editedSinceSubmit
      ) {
        this.replaceableInput = { input: current, value: current.value };
      }
      await this.activate();
      void this.panel?.refreshIfOpen();
      this.replaceableInput = null;
    } catch {
      if (
        generation !== this.generation ||
        !this.observer ||
        this.batch?.batchAlias !== batch.batchAlias
      )
        return;
      this.awaiting = false;
      this.render("结果待确认：回执尚未保存，请在下方核对处理。本批不会自动重发。");
      if (this.batch) void this.unknown();
    } finally {
      if (generation === this.generation) this.resolving = false;
    }
  }
  private async renew(): Promise<void> {
    const batch = this.batch;
    if (!batch || this.resolving) return;
    const generation = this.generation;
    const current = () =>
      generation === this.generation &&
      this.observer &&
      this.batch?.batchAlias === batch.batchAlias;
    try {
      const response = backfillPageResponseSchema.parse(
        await this.options.sendMessage({
          type: "store/backfill-renew",
          batchAlias: batch.batchAlias,
        }),
      );
      if (!response.accepted && current()) await this.unknown();
    } catch {
      if (current()) await this.unknown();
    }
  }
  private async unknown(): Promise<void> {
    const batch = this.batch;
    if (!batch) return;
    this.batch = null;
    this.awaiting = false;
    this.submission = null;
    this.clearTimers();
    const generation = this.generation;
    this.render("结果待确认，请在下方核对处理；语见不会自动重发本批。");
    await this.options
      .sendMessage({ type: "store/backfill-unknown", batchAlias: batch.batchAlias })
      .catch(() => undefined);
    if (generation === this.generation && this.observer) void this.openReview();
  }
  private getPanel(): BackfillReviewPanel {
    this.panel ??= new BackfillReviewPanel({
      document: this.options.document,
      sendMessage: this.options.sendMessage,
      continueBackfill: () => this.activate(),
      ...(this.options.acceptsUserGesture
        ? { acceptsUserGesture: this.options.acceptsUserGesture }
        : {}),
    });
    return this.panel;
  }
  private render(text: string): void {
    this.getPanel().setStatus(text);
  }
}
