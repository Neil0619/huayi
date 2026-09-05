import {
  STORE_MESSAGE_VERSION,
  parseStoreWordbookResponse,
  type DeviceVault,
  type EudicImportJob,
  type ExportOutboxItem,
  type StoreWordbookRequest,
} from "@huayi/store-domain";

interface WordbookOptionsDependencies {
  readonly cloudAuthority?: boolean | undefined;
  readonly sendMessage: (message: StoreWordbookRequest) => Promise<unknown>;
  readonly vault: DeviceVault;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing wordbook options element: ${selector}`);
  return found;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function errorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "authentication-failed":
      return "欧路授权无效，请重新配置。";
    case "credential-missing":
      return "请先配置欧路 Authorization。";
    case "consent-required":
      return "请先在“外部词典数据”中同意欧路的数据接收方、字段、费用与远端保留说明。";
    case "data-corrupt":
      return "生词同步状态已损坏，请停止操作并清除扩展数据后重新配置。";
    case "network-error":
      return "欧路网络请求失败；任务没有自动重试。";
    case "rate-limited":
      return "欧路请求受到限制，请稍后手动重试。";
    case "recipient-disabled":
      return "欧路导入与导出已停用；如需继续，请先在“外部词典数据”中启用。";
    case "timeout":
      return "欧路请求超时；任务没有自动重试。";
    default:
      return "生词同步操作失败，请稍后重试。";
  }
}

function request(type: StoreWordbookRequest["type"]): StoreWordbookRequest {
  return { messageVersion: STORE_MESSAGE_VERSION, type } as StoreWordbookRequest;
}

export class WordbookOptionsController {
  private bound = false;
  private busy = false;
  private configured = false;
  private ready = false;

  constructor(private readonly dependencies: WordbookOptionsDependencies) {}

  async initialize(ready: boolean): Promise<void> {
    if (!this.bound) {
      this.bindEvents();
      this.bound = true;
    }
    await this.setReady(ready);
  }

  async setReady(ready: boolean): Promise<void> {
    this.ready = ready;
    element<HTMLElement>("[data-wordbook-panel]").hidden = !ready;
    if (!ready) return;
    await this.execute(async () => {
      await this.refreshCredential();
      if (this.dependencies.cloudAuthority === true) {
        for (const local of document.querySelectorAll<HTMLElement>(
          "[data-local-wordbook-authority]",
        )) {
          local.hidden = true;
        }
        element<HTMLElement>("[data-cloud-wordbook-authority]").hidden = false;
        return;
      }
      await Promise.all([this.refreshImport(), this.refreshOutbox()]);
    }, "");
  }

  private bindEvents(): void {
    this.bindButton(
      "[data-eudic-auth-save]",
      async () => {
        const input = element<HTMLInputElement>("[data-eudic-auth-input]");
        const authorization = input.value.trim();
        if (
          authorization.length === 0 ||
          authorization.length > 4_096 ||
          /[\r\n]/u.test(authorization)
        ) {
          throw Object.assign(new Error(), { code: "authentication-failed" });
        }
        await this.dependencies.vault.setCredential("eudic-authorization", authorization);
        input.value = "";
        await this.refreshCredential();
      },
      "欧路 Authorization 已加密保存，不会回显。 ",
    );
    this.bindButton(
      "[data-eudic-auth-delete]",
      async () => {
        await this.dependencies.vault.deleteCredential("eudic-authorization");
        await this.refreshCredential();
      },
      "欧路 Authorization 已删除。 ",
    );
    this.bindButton(
      "[data-eudic-import-start]",
      () => this.importAction("store/eudic-import-start"),
      "欧路导入已开始。 ",
    );
    this.bindButton(
      "[data-eudic-import-resume]",
      () => this.importAction("store/eudic-import-resume"),
      "欧路导入已恢复。 ",
    );
    this.bindButton(
      "[data-eudic-import-pause]",
      () => this.importAction("store/eudic-import-pause"),
      "欧路导入已暂停。 ",
    );
    this.bindButton(
      "[data-eudic-import-step]",
      () => this.importAction("store/eudic-import-step"),
      "已处理一个欧路分页检查点。 ",
    );
    this.bindButton("[data-outbox-refresh]", () => this.refreshOutbox(), "导出箱已刷新。 ");
    this.bindButton(
      "[data-outbox-process]",
      async () => {
        await this.send(request("store/outbox-process-one"));
        await this.refreshOutbox();
      },
      "已处理一个欧路导出任务；未自动重试失败任务。 ",
    );
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
      this.setStatus(success.trim(), "success");
    } catch (error) {
      this.setStatus(errorMessage(error), "error");
    } finally {
      this.busy = false;
      this.renderBusy();
    }
  }

  private async refreshCredential(): Promise<void> {
    this.configured = (await this.dependencies.vault.getCredential("eudic-authorization")) !== null;
    element("[data-eudic-auth-status]").textContent = this.configured ? "已配置" : "未配置";
    element<HTMLInputElement>("[data-eudic-auth-input]").placeholder = this.configured
      ? "••••••••"
      : "";
  }

  private async importAction(type: StoreWordbookRequest["type"]): Promise<void> {
    const response = await this.send(request(type));
    if (response.type !== "store/eudic-import-result") throw new Error("Unexpected response.");
    this.renderImport(response.job);
  }

  private async refreshImport(): Promise<void> {
    await this.importAction("store/eudic-import-status");
  }

  private renderImport(job: EudicImportJob): void {
    const state =
      job.state === "source-limit-reached"
        ? "已到公开分页上限，结果不是完整导入"
        : {
            completed: "已完成",
            failed: "失败，可恢复",
            idle: "尚未开始",
            paused: "已暂停",
            running: "运行中",
          }[job.state];
    element("[data-eudic-import-progress]").textContent =
      `${state} · 下一页 ${job.nextPage} · 新增 ${job.importedCount} · 重复 ${job.duplicateCount}`;
    element("[data-eudic-import-error]").textContent =
      job.lastError === undefined ? "" : `最近错误：${errorMessage({ code: job.lastError })}`;
  }

  private async refreshOutbox(): Promise<void> {
    const response = await this.send(request("store/outbox-list"));
    if (response.type !== "store/outbox-result") throw new Error("Unexpected response.");
    this.renderOutbox(response.items);
  }

  private renderOutbox(items: readonly ExportOutboxItem[]): void {
    const list = element("[data-outbox-list]");
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement("li");
      row.textContent = `${item.entryId} · ${item.target} · ${item.state}`;
      if (item.lastError !== undefined) row.append(` · ${errorMessage({ code: item.lastError })}`);
      if (item.state === "failed") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "重新排队";
        retry.addEventListener("click", () => {
          void this.execute(async () => {
            await this.send({
              messageVersion: STORE_MESSAGE_VERSION,
              outboxId: item.id,
              type: "store/outbox-retry",
            });
            await this.refreshOutbox();
          }, "失败任务已重新排队，尚未自动发送。 ");
        });
        row.append(" ", retry);
      }
      list.append(row);
    }
    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "导出箱为空。";
      list.append(empty);
    }
  }

  private async send(message: StoreWordbookRequest) {
    const response = parseStoreWordbookResponse(await this.dependencies.sendMessage(message));
    if (response.type === "store/wordbook-error") {
      throw Object.assign(new Error(), { code: response.code });
    }
    return response;
  }

  private renderBusy(): void {
    element<HTMLElement>("[data-wordbook-panel]").setAttribute("aria-busy", String(this.busy));
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "[data-wordbook-panel] input, [data-wordbook-panel] button",
    )) {
      control.disabled = this.busy;
    }
    if (!this.busy) {
      element<HTMLButtonElement>("[data-eudic-auth-delete]").disabled = !this.configured;
    }
  }

  private setStatus(message: string, tone: "error" | "neutral" | "success"): void {
    const status = element("[data-wordbook-status]");
    status.textContent = message;
    status.setAttribute("data-tone", tone);
  }
}
