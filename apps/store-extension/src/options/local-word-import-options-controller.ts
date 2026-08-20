import {
  STORE_MESSAGE_VERSION,
  parseLocalWordImportResponse,
  type LocalWordImportResponse,
} from "@huayi/store-domain";

interface Dependencies {
  readonly confirmImport: (wordCount: number, contextCount: number) => boolean;
  readonly sendMessage: (message: unknown) => Promise<unknown>;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing local word import element: ${selector}`);
  return found;
}

export class LocalWordImportOptionsController {
  private bound = false;
  private busy = false;
  private preview: Extract<LocalWordImportResponse, { outcome: "preview" }> | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  async initialize(ready: boolean): Promise<void> {
    if (!this.bound) {
      element<HTMLButtonElement>("[data-local-word-import-preview]").addEventListener(
        "click",
        () => {
          void this.run(() => this.previewImport());
        },
      );
      element<HTMLButtonElement>("[data-local-word-import-confirm]").addEventListener(
        "click",
        () => {
          void this.confirmImport();
        },
      );
      element<HTMLButtonElement>("[data-local-word-import-retry]").addEventListener("click", () => {
        void this.run(async () => {
          await this.render(await this.request("store/local-word-import-retry"));
        });
      });
      this.bound = true;
    }
    await this.setReady(ready);
  }

  async setReady(ready: boolean): Promise<void> {
    const panel = element<HTMLElement>("[data-local-word-import-panel]");
    panel.hidden = !ready;
    if (!ready) {
      this.preview = null;
      this.controls();
      return;
    }
    await this.render(await this.request("store/local-word-import-status"));
  }

  private async confirmImport(): Promise<void> {
    const preview = this.preview;
    if (
      preview === null ||
      !this.dependencies.confirmImport(preview.wordCount, preview.contextCount)
    ) {
      return;
    }
    await this.run(async () => {
      const result = parseLocalWordImportResponse(
        await this.dependencies.sendMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          previewId: preview.previewId,
          type: "store/local-word-import-confirm",
        }),
      );
      await this.render(result);
    });
  }

  private async previewImport() {
    const result = await this.request("store/local-word-import-preview");
    this.preview = result.outcome === "preview" ? result : null;
    await this.render(result);
  }

  private async request(
    type:
      | "store/local-word-import-preview"
      | "store/local-word-import-retry"
      | "store/local-word-import-status",
  ) {
    return parseLocalWordImportResponse(
      await this.dependencies.sendMessage({ messageVersion: STORE_MESSAGE_VERSION, type }),
    );
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.controls();
    this.status("正在处理…");
    try {
      await operation();
    } catch {
      this.status("本机生词导入失败，请稍后重试。");
    } finally {
      this.busy = false;
      this.controls();
    }
  }

  private async render(result: LocalWordImportResponse): Promise<void> {
    const summary = element<HTMLElement>("[data-local-word-import-summary]");
    const retry = element<HTMLButtonElement>("[data-local-word-import-retry]");
    retry.hidden = result.outcome !== "retry-pending";
    if (result.outcome === "preview") {
      summary.hidden = false;
      summary.textContent = `本次将导入 ${result.wordCount} 个词条、${result.contextCount} 条语境。`;
      this.status("预览已生成。请核对数量后确认导入。");
    } else if (result.outcome === "progress") {
      summary.hidden = false;
      summary.textContent = `已处理 ${result.processedWordCount}/${result.wordCount} 个词条、${result.processedContextCount}/${result.contextCount} 条语境。`;
      this.status("导入仍在进行；扩展会自动继续处理剩余批次。");
    } else if (result.outcome === "completed") {
      this.preview = null;
      summary.hidden = false;
      summary.textContent = `共 ${result.wordCount} 个词条、${result.contextCount} 条语境；新建 ${result.createdWordCount} 个词条和 ${result.createdContextCount} 条语境，已有 ${result.existingWordCount} 个词条和 ${result.duplicateContextCount} 条重复语境。`;
      this.status("导入完成；本机生词未被删除，Web 现有笔记未被覆盖。");
    } else {
      if (result.outcome !== "retry-pending") summary.hidden = true;
      const messages: Record<typeof result.outcome, string> = {
        "client-upgrade-required": "请先更新划译，再继续导入。",
        empty: "尚无可导入的本机生词。",
        failed: "导入已停止；请重新预览后再试。",
        "not-configured": "云端服务尚未配置。",
        "retry-pending": "网络暂时不可用；可以立即重试，扩展也会自动继续。",
        "session-unavailable": "请先在插件中关联 Web 账号。",
        "snapshot-changed": "本机生词已变化，请重新预览数量。",
        "upload-disabled": "联网同意已关闭，未上传本机生词。",
      };
      this.status(messages[result.outcome]);
    }
    this.controls();
  }

  private controls() {
    element<HTMLButtonElement>("[data-local-word-import-preview]").disabled = this.busy;
    element<HTMLButtonElement>("[data-local-word-import-confirm]").disabled =
      this.busy || this.preview === null;
    element<HTMLButtonElement>("[data-local-word-import-retry]").disabled = this.busy;
  }

  private status(message: string) {
    element("[data-local-word-import-status]").textContent = message;
  }
}
