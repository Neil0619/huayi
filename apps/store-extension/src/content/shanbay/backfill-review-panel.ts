import {
  backfillPageReviewResponseSchema,
  backfillPageReviewMutationResponseSchema,
  type BackfillPageReviewResponse,
  type BackfillMessage,
} from "../../backfill/backfill-messages.js";
import {
  backfillReviewCopy,
  backfillReviewNeedsRefresh,
  backfillReviewHasMore,
  unknownBackfillConfirmation,
} from "./backfill-review-copy.js";
import { requestBackfillReview } from "./backfill-review-request.js";
import { renderBackfillReviewRows } from "./backfill-review-rows.js";
import { backfillReviewStyles } from "./backfill-review-styles.js";

export class BackfillReviewPanel {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly notice: HTMLElement;
  private readonly review: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly pagination: HTMLElement;
  private readonly error: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly resume: HTMLButtonElement;
  private readonly discardAll: HTMLButtonElement;
  private readonly cancelDiscard: HTMLButtonElement;
  private readonly help: HTMLElement;
  private discardAllArmed = false;
  private readonly pending = new Set<string>();
  private lastUpdate = 0;
  private refreshPending = false;
  private current: BackfillPageReviewResponse | null = null;
  private readonly drafts = new Map<string, string>();
  private disposed = false;
  private busy = false;
  private stale = false;
  private protectedRemainder = false;
  private generation = 0;
  constructor(
    private readonly options: {
      document: Document;
      sendMessage: (message: unknown) => Promise<unknown>;
      continueBackfill: () => Promise<void>;
      acceptsUserGesture?: (event: Event) => boolean;
      confirm?: (text: string) => boolean;
    },
  ) {
    this.host = this.node("div");
    this.host.dataset.huayiBackfill = "";
    this.root = this.host.attachShadow({ mode: "open" });
    const style = this.node("style", backfillReviewStyles);
    const aside = this.node("aside");
    aside.setAttribute("aria-label", "语见扇贝回填");
    const header = this.node("header");
    this.toggle = this.button(
      "需处理",
      async () => {
        if (this.review.hidden) await this.open();
        else {
          this.review.hidden = true;
          this.toggle.textContent = "需处理";
          this.toggle.setAttribute("aria-expanded", "false");
        }
      },
      false,
    );
    this.toggle.setAttribute("aria-expanded", "false");
    header.append(this.node("h2", "语见 · 扇贝回填"), this.toggle);
    this.notice = this.node("p");
    this.notice.className = "notice";
    this.notice.dataset.backfillNotice = "";
    this.notice.setAttribute("role", "status");
    this.review = this.node("div");
    this.review.className = "review";
    this.review.hidden = true;
    this.summary = this.node("p");
    this.summary.className = "summary";
    const toolbar = this.node("div");
    toolbar.className = "toolbar";
    this.resume = this.button("继续回填", async () => {
      this.review.hidden = true;
      this.toggle.textContent = "需处理";
      this.toggle.setAttribute("aria-expanded", "false");
      await this.options.continueBackfill();
    });
    this.resume.className = "primary";
    this.discardAll = this.button("全部丢弃", async () => {
      if (!this.current || this.current.unresolvedCount + this.current.unknownCount === 0) return;
      if (!this.discardAllArmed) {
        this.discardAllArmed = true;
        this.error.textContent = `确认后，${this.current.unresolvedCount} 个未解决词和 ${this.current.unknownCount} 个结果待确认词将不再提醒；扇贝已添加的词不会删除，待回填和正在提交的词保留。`;
        this.updateControls();
        return;
      }
      await this.mutate({ type: "store/backfill-page-review-discard-all" }, "all");
    });
    this.discardAll.className = "danger";
    this.cancelDiscard = this.button("取消", async () => {
      this.discardAllArmed = false;
      this.error.textContent = "";
      this.updateControls();
    });
    toolbar.append(
      this.button("刷新列表", () => this.read()),
      this.resume,
      this.discardAll,
      this.cancelDiscard,
    );
    this.list = this.node("div");
    this.list.className = "list";
    this.list.setAttribute("aria-label", "需处理词列表");
    this.pagination = this.node("div");
    this.pagination.className = "pagination";
    this.help = this.node("p");
    this.help.className = "help";
    this.error = this.node("p");
    this.error.className = "error";
    this.error.setAttribute("role", "alert");
    this.review.append(this.summary, toolbar, this.error, this.list, this.pagination, this.help);
    aside.append(header, this.notice, this.review);
    this.root.append(style, aside);
    options.document.body.append(this.host);
    this.updateControls();
  }
  setStatus(text: string): void {
    if (!this.disposed && this.notice.textContent !== text) this.notice.textContent = text;
  }
  async open(): Promise<void> {
    if (this.disposed) return;
    this.review.hidden = false;
    this.toggle.textContent = "收起";
    this.toggle.setAttribute("aria-expanded", "true");
    await this.read();
  }
  async refreshIfOpen(): Promise<void> {
    if (this.review.hidden) return;
    if (this.pending.size || this.busy) this.refreshPending = true;
    else await this.read();
  }
  destroy(): void {
    this.disposed = true;
    this.generation += 1;
    this.drafts.clear();
    this.host.remove();
  }
  private node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const element = this.options.document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  }
  private button(text: string, work: () => Promise<void>, locks = true): HTMLButtonElement {
    const control = this.node("button", text);
    control.type = "button";
    if (locks) control.dataset.lock = "";
    control.addEventListener("click", (event) => {
      if (
        this.disposed ||
        (locks && this.busy) ||
        !(this.options.acceptsUserGesture?.(event) ?? event.isTrusted)
      )
        return;
      void work().catch(() => {
        if (!this.disposed) this.error.textContent = "操作未完成，请刷新列表后重试。";
      });
    });
    return control;
  }
  private lock(value: boolean): void {
    this.busy = value;
    this.updateControls();
  }
  private updateControls(): void {
    for (const control of this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "[data-lock],input",
    )) {
      const row = control.closest<HTMLElement>(".row");
      control.disabled =
        this.busy ||
        (row
          ? this.pending.has("all") ||
            this.pending.has(row.dataset.reviewAlias ?? "") ||
            (control.tagName === "BUTTON" && this.stale)
          : this.pending.size > 0);
    }
    this.resume.disabled = this.busy || this.pending.size > 0 || !this.current?.pendingCount;
    this.resume.hidden = !this.current?.pendingCount;
    this.discardAll.disabled =
      this.busy ||
      this.stale ||
      this.pending.size > 0 ||
      !(this.current && this.current.unresolvedCount + this.current.unknownCount);
    this.discardAll.hidden =
      !this.current || this.current.unresolvedCount + this.current.unknownCount === 0;
    this.discardAll.textContent = this.pending.has("all")
      ? "正在丢弃…"
      : `${this.discardAllArmed ? "确认全部丢弃" : "全部丢弃"}（${(this.current?.unresolvedCount ?? 0) + (this.current?.unknownCount ?? 0)}）`;
    this.cancelDiscard.hidden = !this.discardAllArmed;
  }
  private request(message: unknown): Promise<unknown> {
    return requestBackfillReview(this.options.sendMessage, message, {
      stale: () => {
        this.stale = true;
      },
      unavailable: () => {
        if (this.disposed) return;
        this.current = null;
        this.drafts.clear();
        this.list.replaceChildren();
        this.pagination.replaceChildren();
        this.summary.textContent = "请从语见弹窗重新打开扇贝回填。";
        this.notice.textContent = "当前账号或页面已失效。";
        this.help.textContent = "";
      },
    });
  }
  private async read(cursorAlias?: string): Promise<void> {
    if (this.disposed || this.busy || this.pending.size) return;
    const generation = ++this.generation;
    this.stale = true;
    this.lock(true);
    this.error.textContent = "";
    if (!this.current) this.summary.textContent = "正在读取需处理词…";
    try {
      const response = backfillPageReviewResponseSchema.parse(
        await this.request({
          type: "store/backfill-page-review",
          ...(cursorAlias ? { cursorAlias } : {}),
        }),
      );
      if (this.disposed || generation !== this.generation) return;
      this.current = response;
      this.lastUpdate = 0;
      this.discardAllArmed = false;
      this.stale = false;
      this.render();
    } catch {
      if (!this.disposed && generation === this.generation)
        this.error.textContent = this.current
          ? "暂时无法读取列表，请刷新重试。已有输入会保留。"
          : "暂时无法读取列表，请刷新或从语见弹窗重新打开。";
    } finally {
      if (!this.disposed && generation === this.generation) {
        this.lock(false);
        await this.flushRefresh();
      }
    }
  }
  private async mutate(message: BackfillMessage, alias: string, source?: string): Promise<void> {
    if (
      this.disposed ||
      this.busy ||
      this.stale ||
      this.pending.has(alias) ||
      this.pending.has("all")
    )
      return;
    const generation = this.generation;
    const previous = this.current && { ...this.current };
    this.pending.add(alias);
    this.discardAllArmed = false;
    this.error.textContent = "";
    const rows = [...this.list.querySelectorAll<HTMLElement>(".row")].filter(
      (row) => alias === "all" || row.dataset.reviewAlias === alias,
    );
    for (const row of rows) {
      const progress = row.querySelector(".row-progress");
      if (progress) progress.textContent = "正在保存…";
    }
    this.updateControls();
    try {
      const response = backfillPageReviewMutationResponseSchema.parse(await this.request(message));
      if (this.disposed || generation !== this.generation || !this.current) return;
      if (source) this.drafts.delete(source);
      if (alias === "all") {
        this.protectedRemainder = response.unresolvedCount + response.unknownCount > 0;
        this.refreshPending ||= response.unresolvedCount + response.unknownCount > 0;
        if (response.unresolvedCount === 0) this.drafts.clear();
        this.current.items = [];
        this.current.unknownBatches = [];
        this.current.nextCursorAlias = null;
        this.list.replaceChildren();
        this.pagination.replaceChildren();
      } else {
        this.current.items = this.current.items.filter((item) => item.alias !== alias);
        this.current.unknownBatches = this.current.unknownBatches.filter(
          (batch) => batch.alias !== alias,
        );
        for (const row of rows) row.remove();
      }
      if (response.update > this.lastUpdate) {
        this.lastUpdate = response.update;
        Object.assign(this.current, {
          pendingCount: response.pendingCount,
          unresolvedCount: response.unresolvedCount,
          unknownCount: response.unknownCount,
        });
      }
      if (this.current.unknownCount === 0) {
        this.current.unknownBatches = [];
        for (const row of this.list.querySelectorAll('[data-review-kind="unknown"]')) row.remove();
      }
      if (message.type === "store/backfill-page-review-discard-unknown")
        this.refreshPending ||= backfillReviewNeedsRefresh(previous, this.current, alias);
      this.updateSummary();
    } catch {
      if (!this.disposed && generation === this.generation) {
        this.stale = true;
        this.error.textContent = this.current
          ? "操作结果尚未确认，请先刷新列表。输入已保留，不会自动重发。"
          : "当前账号或页面已失效，请从语见弹窗重新打开扇贝回填。";
        for (const row of rows) {
          const progress = row.querySelector(".row-progress");
          if (progress) progress.textContent = "保存未确认";
        }
      }
    } finally {
      this.pending.delete(alias);
      if (!this.disposed) {
        this.updateControls();
        await this.flushRefresh();
      }
    }
  }
  private async flushRefresh(): Promise<void> {
    if (!this.refreshPending || this.pending.size || this.busy || this.disposed) return;
    this.refreshPending = false;
    await this.read();
  }
  private updateSummary(): void {
    if (!this.current) return;
    const copy = backfillReviewCopy(this.current, this.protectedRemainder);
    this.summary.textContent = copy.summary;
    this.help.textContent = copy.help;
    this.notice.textContent = copy.notice;
    if (this.current.unresolvedCount + this.current.unknownCount === 0)
      this.pagination.replaceChildren();
  }

  private render(): void {
    if (!this.current) return;
    this.updateSummary();
    this.list.replaceChildren(
      ...renderBackfillReviewRows({
        document: this.options.document,
        view: this.current,
        drafts: this.drafts,
        button: (text, work) => this.button(text, work),
        replace: async (alias, source, input) => {
          if (!input.value.trim()) {
            input.focus();
            this.error.textContent = "请填写回填目标词。";
            return;
          }
          await this.mutate(
            {
              type: "store/backfill-page-review-replace",
              sourceAlias: alias,
              target: input.value.trim(),
            },
            alias,
            source,
          );
        },
        discard: (alias, source) =>
          this.mutate(
            { type: "store/backfill-page-review-discard", sourceAlias: alias },
            alias,
            source,
          ),
        discardUnknown: (alias) => this.resolveUnknown(alias, true),
        retryUnknown: (alias) => this.resolveUnknown(alias, false),
      }),
    );
    this.pagination.replaceChildren();
    const cursorAlias = this.current.nextCursorAlias;
    if (cursorAlias) this.pagination.append(this.button("下一页", () => this.read(cursorAlias)));
    if (backfillReviewHasMore(this.current))
      this.pagination.append(this.button("回到首屏", () => this.read()));
  }
  private async resolveUnknown(alias: string, discard: boolean): Promise<void> {
    const confirm =
      this.options.confirm ?? ((text) => this.options.document.defaultView?.confirm(text) ?? false);
    if (!confirm(unknownBackfillConfirmation(discard))) return;
    await this.mutate(
      {
        type: discard
          ? "store/backfill-page-review-discard-unknown"
          : "store/backfill-page-review-retry-unknown",
        batchAlias: alias,
      },
      alias,
    );
  }
}
