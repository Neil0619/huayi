import {
  STORE_MESSAGE_VERSION,
  parseStorePopupStatusResponse,
  parseStoreSitePolicyResponse,
  type StorePopupStatusResponse,
  type StoreSitePolicyResponse,
} from "@huayi/store-domain";

interface ActiveTab {
  readonly id: number;
}

interface PopupPageDependencies {
  readonly openOptionsPage: () => Promise<void>;
  readonly queryActiveTab: () => Promise<ActiveTab | null>;
  readonly sendRuntimeMessage: (message: unknown) => Promise<unknown>;
  readonly sendTabMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

class PopupPageError extends Error {}

function isMissingContentReceiver(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing Store popup element: ${selector}`);
  return found;
}

export class PopupPage {
  private activeTabId: number | null = null;
  private busy = false;
  private sitePolicy: StoreSitePolicyResponse | null = null;
  private status: StorePopupStatusResponse | null = null;
  private unsupportedTab = false;

  constructor(private readonly dependencies: PopupPageDependencies) {}

  async initialize(): Promise<void> {
    element<HTMLButtonElement>("[data-open-options]").addEventListener("click", () => {
      void this.execute(async () => this.openOptions());
    });
    element<HTMLInputElement>("[data-site-enabled]").addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      void this.execute(async () => this.toggleSite(enabled));
    });
    element<HTMLInputElement>("[data-global-enabled]").addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      void this.execute(async () => this.toggleGlobal(enabled));
    });
    element<HTMLButtonElement>("[data-toggle-overlay-theme]").addEventListener("click", () => {
      void this.execute(async () => this.toggleOverlayTheme());
    });
    await this.execute(async () => {
      const [status, tab] = await Promise.all([
        this.dependencies.sendRuntimeMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/popup-status",
        }),
        this.dependencies.queryActiveTab(),
      ]);
      this.status = parseStorePopupStatusResponse(status);
      if (tab === null) {
        this.unsupportedTab = true;
        return;
      }
      this.activeTabId = tab.id;
      try {
        this.sitePolicy = parseStoreSitePolicyResponse(
          await this.dependencies.sendTabMessage(tab.id, {
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/popup-site-policy",
          }),
        );
      } catch (error) {
        if (isMissingContentReceiver(error)) {
          this.unsupportedTab = true;
          return;
        }
        throw error;
      }
    });
  }

  private async toggleSite(enabled: boolean): Promise<void> {
    if (this.activeTabId === null) throw new PopupPageError("当前标签页不支持划译。");
    const current = await this.dependencies.queryActiveTab();
    if (current === null || current.id !== this.activeTabId) {
      throw new PopupPageError("标签页已切换，请重新打开划译弹窗后再试。");
    }
    this.sitePolicy = parseStoreSitePolicyResponse(
      await this.dependencies.sendTabMessage(current.id, {
        enabled,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-site-toggle",
      }),
    );
  }

  private async toggleGlobal(enabled: boolean): Promise<void> {
    this.status = parseStorePopupStatusResponse(
      await this.dependencies.sendRuntimeMessage({
        enabled,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-global-toggle",
      }),
    );
  }

  private async toggleOverlayTheme(): Promise<void> {
    if (this.status === null) throw new PopupPageError("词卡皮肤状态尚未就绪。");
    const overlayTheme = this.status.overlayTheme === "pearl" ? "parchment" : "pearl";
    this.status = parseStorePopupStatusResponse(
      await this.dependencies.sendRuntimeMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme,
        type: "store/popup-overlay-theme",
      }),
    );
  }

  private async openOptions(): Promise<void> {
    try {
      await this.dependencies.openOptionsPage();
    } catch {
      throw new PopupPageError("无法打开设置页，请稍后重试。");
    }
  }

  private async execute(operation: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setPageStatus("", "neutral");
    this.render();
    try {
      await operation();
      this.setPageStatus("", "neutral");
    } catch (error) {
      this.setPageStatus(
        error instanceof PopupPageError ? error.message : "扩展状态读取失败，请稍后重试。",
        "error",
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    const status = this.status;
    const provider = status?.providerId === "deepseek" ? "DeepSeek" : "OpenAI";
    element("[data-provider]").textContent = provider;
    element("[data-model-consent]").textContent = status?.modelConsentGranted
      ? "已允许联网"
      : "模型联网未开启";
    const toggle = element<HTMLInputElement>("[data-site-enabled]");
    toggle.checked = this.sitePolicy?.enabled ?? false;
    toggle.disabled =
      this.busy || this.sitePolicy === null || this.status?.globallyEnabled === false;
    const globalToggle = element<HTMLInputElement>("[data-global-enabled]");
    globalToggle.checked = status?.globallyEnabled ?? false;
    globalToggle.disabled = this.busy || status === null;
    element<HTMLButtonElement>("[data-toggle-overlay-theme]").disabled =
      this.busy || status === null;
    document.body.dataset.overlayTheme = status?.overlayTheme ?? "pearl";
    element("[data-site-host]").textContent = this.unsupportedTab
      ? "当前标签页不支持划译"
      : (this.sitePolicy?.host ?? "正在读取当前页面…");
    document.body.setAttribute("aria-busy", String(this.busy));
  }

  private setPageStatus(message: string, tone: "error" | "neutral" | "success"): void {
    const status = element("[data-popup-status]");
    status.textContent = message;
    status.dataset.tone = tone;
  }
}
