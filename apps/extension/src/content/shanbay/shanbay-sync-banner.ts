import type { WordSyncUnresolvedListEvent } from "@huayi/protocol";

import { appendUnresolvedPanel } from "./shanbay-unresolved-panel.js";

const BANNER_ATTRIBUTE = "data-huayi-shanbay-sync";

export interface BannerActionOptions {
  confirmLabel?: string;
  keepLabel?: string;
  onConfirm(): void;
  onKeep(): void;
}

export interface UnresolvedBannerOptions {
  event: WordSyncUnresolvedListEvent;
  onDiscard(sourceWords: string[]): void;
  onDiscardAll(): void;
  onPage(offset: number): void;
  onRequeue(items: { sourceWord: string; targetWord: string }[]): void;
}

export class ShanbaySyncBanner {
  private readonly document: Document;
  private host: HTMLElement | null = null;

  constructor(document: Document) {
    this.document = document;
  }

  destroy(): void {
    this.host?.remove();
    this.host = null;
  }

  render(message: string, actions?: BannerActionOptions): HTMLElement | null {
    const shadow = this.ensureHost().shadowRoot;
    if (shadow === null) return null;
    shadow.querySelector(".bar")?.remove();
    const bar = this.document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "status");
    const text = this.document.createElement("div");
    text.textContent = message;
    bar.append(text);
    if (actions !== undefined) {
      const actionRow = this.document.createElement("div");
      actionRow.className = "actions";
      const confirm = this.document.createElement("button");
      confirm.className = "primary";
      confirm.type = "button";
      confirm.textContent = actions.confirmLabel ?? "确认已全部添加";
      confirm.addEventListener("click", actions.onConfirm);
      const keep = this.document.createElement("button");
      keep.type = "button";
      keep.textContent = actions.keepLabel ?? "保留待同步";
      keep.addEventListener("click", actions.onKeep);
      actionRow.append(confirm, keep);
      bar.append(actionRow);
    }
    shadow.append(bar);
    return bar;
  }

  renderUnresolved(message: string, options: UnresolvedBannerOptions): void {
    const bar = this.render(message);
    if (bar === null) return;
    appendUnresolvedPanel(bar, {
      document: this.document,
      event: options.event,
      onDiscard: options.onDiscard,
      onDiscardAll: options.onDiscardAll,
      onPage: options.onPage,
      onRequeue: options.onRequeue,
    });
  }

  private ensureHost(): HTMLElement {
    if (this.host !== null) return this.host;
    const host = this.document.createElement("div");
    host.setAttribute(BANNER_ATTRIBUTE, "");
    const shadow = host.attachShadow({ mode: "open" });
    const style = this.document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .bar { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px;
        max-width: 440px; padding: 12px 14px; border-radius: 10px; color: #fff;
        background: #174f43; box-shadow: 0 8px 24px rgba(0,0,0,.24);
        font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      button { border: 1px solid rgba(255,255,255,.65); border-radius: 6px; padding: 5px 10px;
        color: #fff; background: transparent; cursor: pointer; font: inherit; }
      button.primary { color: #174f43; background: #fff; }
      button.danger { border-color: #ffd4cc; color: #fff4f2; }
      button.danger:hover { background: rgba(150,28,14,.35); }
      button.compact { padding: 5px 8px; white-space: nowrap; }
      button:disabled, input:disabled { cursor: wait; opacity: .55; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .unresolved { max-height: 52vh; overflow: auto; margin-top: 10px; }
      .unresolved-row { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(130px, 1fr);
        gap: 6px 10px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,.2); }
      .unresolved-row small { grid-column: 1 / -1; opacity: .8; }
      .replacement-controls { display: grid; grid-template-columns: minmax(110px, 1fr) auto;
        gap: 6px; }
      input { min-width: 0; border: 1px solid rgba(255,255,255,.55); border-radius: 5px;
        padding: 5px 7px; color: #173f37; background: #fff; font: inherit; }
    `;
    shadow.append(style);
    this.document.documentElement.append(host);
    this.host = host;
    return host;
  }
}
