import type {
  LexiconPage,
  LexiconRepository,
  WordbookExportEngine,
  WordEntry,
} from "@huayi/store-domain";

import type { TextFileAdapter } from "./text-file-adapter.js";

export type { TextFileAdapter } from "./text-file-adapter.js";

const PAGE_SIZE = 20;

interface LexiconOptionsDependencies {
  readonly clock: () => Date;
  readonly confirmDelete: (headword: string) => boolean;
  readonly files: TextFileAdapter;
  readonly lexicon: LexiconRepository;
  readonly wordbook: Pick<WordbookExportEngine, "cancelEntry">;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing lexicon options element: ${selector}`);
  return found;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  if (errorCode(error) === "data-corrupt") return "本地生词数据已损坏，请清除扩展数据后重试。";
  if (errorCode(error) === "concurrent-modification") return "生词本已发生变化，请重试。";
  return "生词本操作失败，请稍后重试。";
}

function filenameDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class LexiconOptionsController {
  private busy = false;
  private bound = false;
  private cursor: string | undefined;
  private nextCursor: string | null = null;
  private search = "";
  private ready = false;

  constructor(private readonly dependencies: LexiconOptionsDependencies) {}

  async initialize(ready: boolean): Promise<void> {
    if (!this.bound) {
      this.bindEvents();
      this.bound = true;
    }
    await this.setReady(ready);
  }

  async setReady(ready: boolean): Promise<void> {
    this.ready = ready;
    element<HTMLElement>("[data-lexicon-panel]").hidden = !ready;
    if (!ready) {
      this.cursor = undefined;
      this.nextCursor = null;
      element("[data-lexicon-list]").replaceChildren();
      return;
    }
    await this.execute(() => this.load(undefined), "生词本已加载。");
  }

  private bindEvents(): void {
    this.bindForm(
      "[data-lexicon-search-form]",
      async () => {
        this.search = element<HTMLInputElement>("[data-lexicon-search]").value.trim();
        await this.load(undefined);
      },
      "搜索结果已更新。",
    );
    this.bindButton(
      "[data-lexicon-next]",
      async () => {
        if (this.nextCursor !== null) await this.load(this.nextCursor);
      },
      "下一页已加载。",
    );
    this.bindButton("[data-word-list-export]", () => this.exportWordList(), "词表已下载。");
  }

  private bindForm(selector: string, operation: () => Promise<void>, success: string): void {
    element<HTMLFormElement>(selector).addEventListener("submit", (event) => {
      event.preventDefault();
      void this.execute(operation, success);
    });
  }

  private bindButton(selector: string, operation: () => Promise<void>, success: string): void {
    element<HTMLButtonElement>(selector).addEventListener("click", () => {
      void this.execute(operation, success);
    });
  }

  private async execute(operation: () => Promise<void>, success: string): Promise<void> {
    if (this.busy || !this.ready) return;
    this.busy = true;
    this.renderBusy();
    this.setStatus("正在处理…", "neutral");
    try {
      await operation();
      this.setStatus(success, "success");
    } catch (error) {
      this.setStatus(errorMessage(error), "error");
    } finally {
      this.busy = false;
      this.renderBusy();
    }
  }

  private async load(cursor: string | undefined): Promise<void> {
    const query = {
      ...(cursor === undefined ? {} : { cursor }),
      limit: PAGE_SIZE,
      ...(this.search.length === 0 ? {} : { search: this.search }),
    };
    const page = await this.dependencies.lexicon.list(query);
    this.cursor = cursor;
    this.nextCursor = page.nextCursor;
    this.renderPage(page);
  }

  private renderPage(page: LexiconPage): void {
    const list = element("[data-lexicon-list]");
    list.replaceChildren(...page.entries.map((entry) => this.renderEntry(entry)));
    if (page.entries.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "没有匹配的本地生词。";
      list.append(empty);
    }
    element<HTMLButtonElement>("[data-lexicon-next]").disabled =
      this.busy || this.nextCursor === null;
  }

  private renderEntry(entry: WordEntry): HTMLElement {
    const article = document.createElement("article");
    article.className = "lexicon-entry";
    const heading = document.createElement("h3");
    heading.textContent = entry.headword;
    const contexts = document.createElement("ul");
    for (const context of entry.contexts) {
      const item = document.createElement("li");
      const sentence = document.createElement("p");
      sentence.textContent = context.sentence;
      const meaning = document.createElement("p");
      meaning.textContent =
        context.source === "eudic-import"
          ? "欧路历史记录未提供语境释义。"
          : context.contextualMeaningZh;
      item.append(sentence, meaning);
      contexts.append(item);
    }
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.dataset.deleteEntry = "";
    remove.type = "button";
    remove.textContent = "仅从本地删除";
    remove.addEventListener("click", () => {
      if (!this.dependencies.confirmDelete(entry.headword)) return;
      void this.execute(async () => {
        await this.dependencies.wordbook.cancelEntry(entry.id);
        await this.dependencies.lexicon.delete(entry.id);
        await this.load(this.cursor);
      }, "本地词条已删除；远端词典未更改。");
    });
    article.append(heading, contexts, remove);
    return article;
  }

  private async exportWordList(): Promise<void> {
    const plaintext = await this.dependencies.lexicon.exportWordList();
    await this.dependencies.files.downloadText(
      `huayi-words-${filenameDate(this.dependencies.clock())}.txt`,
      plaintext,
      "text/plain;charset=utf-8",
    );
  }

  private renderBusy(): void {
    element<HTMLElement>("[data-lexicon-panel]").setAttribute("aria-busy", String(this.busy));
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "[data-lexicon-panel] input, [data-lexicon-panel] button",
    )) {
      control.disabled = this.busy;
    }
    if (!this.busy) {
      element<HTMLButtonElement>("[data-lexicon-next]").disabled = this.nextCursor === null;
    }
  }

  private setStatus(message: string, tone: "error" | "neutral" | "success"): void {
    const status = element("[data-lexicon-status]");
    status.textContent = message;
    status.setAttribute("data-tone", tone);
  }
}
