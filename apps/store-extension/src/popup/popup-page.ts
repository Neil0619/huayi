import {
  STORE_MESSAGE_VERSION,
  parseStoreAppearance,
  parseSubmissionOutboxResponse,
  parseStorePopupStatusResponse,
  parseStoreSitePolicyResponse,
  type StorePopupStatusResponse,
  type StoreSitePolicyResponse,
  type StoreAppearance,
  type SubmissionOutboxResponse,
} from "@huayi/store-domain";
import { CloudAccountControls } from "../page-ui/cloud-account-controls.js";
import type { StoreAppearanceRepository } from "../service-worker/store-appearance.js";
import { renderPopupOutbox } from "./popup-outbox-view.js";

interface ActiveTab {
  readonly id: number;
}

interface PopupPageDependencies {
  readonly appearance?: StoreAppearanceRepository;
  readonly subscribeToCloudSession?: (onChanged: () => void) => () => void;
  readonly notifySettingsChanged?: () => Promise<void>;
  readonly openOptionsPage: () => Promise<void>;
  readonly queryActiveTab: () => Promise<ActiveTab | null>;
  readonly sendRuntimeMessage: (message: unknown) => Promise<unknown>;
  readonly sendTabMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

class PopupPageError extends Error {}
type PopupOperation = "appearance" | "global" | "site" | "outbox" | "options";

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
  private readonly busy = new Set<PopupOperation>();
  private appearance: StoreAppearance | null = null;
  private appearanceRevision = 0;
  private focusOutboxAfterRender = false;
  private outboxClearConfirmation = false;
  private sitePolicy: StoreSitePolicyResponse | null = null;
  private status: StorePopupStatusResponse | null = null;
  private submissionOutbox: SubmissionOutboxResponse | null = null;
  private submissionOutboxUnavailable = false;
  private unsupportedTab = false;

  constructor(private readonly dependencies: PopupPageDependencies) {}

  async initialize(): Promise<void> {
    element<HTMLButtonElement>("[data-open-options]").addEventListener("click", () => {
      void this.execute("options", async () => this.openOptions());
    });
    element<HTMLInputElement>("[data-site-enabled]").addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      void this.execute("site", async () => this.toggleSite(enabled));
    });
    element<HTMLInputElement>("[data-global-enabled]").addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      void this.execute("global", async () => this.toggleGlobal(enabled));
    });
    const paletteToggle = element<HTMLButtonElement>("[data-toggle-appearance]");
    const palette = element("[data-popup-appearance]");
    paletteToggle.addEventListener("click", () => {
      palette.hidden = !palette.hidden;
      paletteToggle.setAttribute("aria-expanded", String(!palette.hidden));
    });
    palette.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      palette.hidden = true;
      paletteToggle.setAttribute("aria-expanded", "false");
      paletteToggle.focus();
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-popup-theme]")) {
      button.addEventListener("click", () => {
        void this.execute("appearance", () =>
          this.changeAppearance(parseStoreAppearance(button.dataset.popupTheme)),
        );
      });
    }
    const account = new CloudAccountControls({
      ...(this.dependencies.subscribeToCloudSession
        ? { subscribe: this.dependencies.subscribeToCloudSession }
        : {}),
      sendMessage: this.dependencies.sendRuntimeMessage,
      reportError: (message) => this.setPageStatus(message, "error"),
      onChanged: async () => {
        await this.readSubmissionOutbox();
        this.render();
      },
    });
    element<HTMLButtonElement>("[data-submission-outbox-retry]").addEventListener("click", () => {
      void this.execute("outbox", async () => this.retrySubmissionOutbox());
    });
    element<HTMLButtonElement>("[data-submission-outbox-clear]").addEventListener("click", () => {
      if (!this.outboxClearConfirmation) {
        this.outboxClearConfirmation = true;
        this.setPageStatus(
          "再次点击将清空本机待上传的采集与生词，云端已有记录不受影响。",
          "neutral",
        );
        this.render();
        return;
      }
      void this.execute("outbox", async () => this.clearSubmissionOutbox());
    });
    const appearanceRevision = this.appearanceRevision;
    await Promise.all([
      this.dependencies.appearance?.get().then((appearance) => {
        if (appearanceRevision === this.appearanceRevision) this.applyAppearance(appearance);
      }),
      this.execute("global", async () => {
        this.status = parseStorePopupStatusResponse(
          await this.dependencies.sendRuntimeMessage({
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/popup-status",
          }),
        );
      }),
      account.initialize(),
      this.execute("outbox", () => this.readSubmissionOutbox()),
      this.execute("site", async () => {
        const tab = await this.dependencies.queryActiveTab();
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
      }),
    ]);
  }

  private async toggleSite(enabled: boolean): Promise<void> {
    if (this.activeTabId === null) throw new PopupPageError("当前标签页不支持语见。");
    const current = await this.dependencies.queryActiveTab();
    if (current === null || current.id !== this.activeTabId) {
      throw new PopupPageError("标签页已切换，请重新打开语见弹窗后再试。");
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

  applyAppearance(appearance: StoreAppearance): void {
    this.appearanceRevision += 1;
    this.appearance = appearance;
    if (this.status) this.status = { ...this.status, appearance };
    this.render();
  }

  private async changeAppearance(appearance: StoreAppearance): Promise<void> {
    if (!this.dependencies.appearance) return;
    const previous = this.appearance ?? this.status?.appearance ?? "silver";
    this.applyAppearance(appearance);
    try {
      await this.dependencies.appearance.set(appearance);
    } catch {
      this.applyAppearance(previous);
      throw new PopupPageError("未能保存外观，已恢复原主题，请重试。");
    }
    await this.dependencies.notifySettingsChanged?.();
  }

  private async readSubmissionOutbox(): Promise<void> {
    try {
      this.submissionOutbox = parseSubmissionOutboxResponse(
        await this.dependencies.sendRuntimeMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/submission-outbox-status",
        }),
      );
      this.submissionOutboxUnavailable = false;
    } catch {
      this.submissionOutbox = null;
      this.submissionOutboxUnavailable = true;
    }
  }

  private async retrySubmissionOutbox(): Promise<string> {
    if (this.submissionOutbox?.state !== "queued") {
      throw new PopupPageError("当前没有可重试的待提交学习采集。");
    }
    this.outboxClearConfirmation = false;
    this.submissionOutbox = parseSubmissionOutboxResponse(
      await this.dependencies.sendRuntimeMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/submission-outbox-retry",
      }),
    );
    switch (this.submissionOutbox.outcome) {
      case "retry-pending":
        return "暂时仍无法提交，稍后会自动重试。";
      case "submitted":
        return "已提交到收集箱。";
      case "session-invalid":
        return "云端连接已失效，待提交学习采集已清除。";
      case "discarded":
        return "一条无法提交的内容已从本机移除。";
      default:
        return "待提交学习采集状态已刷新。";
    }
  }

  private async clearSubmissionOutbox(): Promise<string> {
    this.submissionOutbox = parseSubmissionOutboxResponse(
      await this.dependencies.sendRuntimeMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/submission-outbox-clear",
      }),
    );
    this.outboxClearConfirmation = false;
    this.focusOutboxAfterRender = true;
    return "已清空本机待上传内容，云端已有记录不受影响。";
  }

  private async openOptions(): Promise<void> {
    try {
      await this.dependencies.openOptionsPage();
    } catch {
      throw new PopupPageError("无法打开设置页，请稍后重试。");
    }
  }

  private async execute(scope: PopupOperation, operation: () => Promise<unknown>): Promise<void> {
    if (this.busy.has(scope)) return;
    this.busy.add(scope);
    this.setPageStatus("", "neutral");
    this.render();
    try {
      const result = await operation();
      const message = typeof result === "string" ? result : undefined;
      if (message !== undefined) this.setPageStatus(message, "success");
    } catch (error) {
      this.setPageStatus(
        error instanceof PopupPageError ? error.message : "扩展状态读取失败，请稍后重试。",
        "error",
      );
    } finally {
      this.busy.delete(scope);
      this.render();
    }
  }

  private render(): void {
    const status = this.status;
    const appearance = this.appearance ?? status?.appearance ?? "silver";
    document.documentElement.dataset.appearance = appearance;
    const provider = status?.providerId === "deepseek" ? "DeepSeek" : "OpenAI";
    element("[data-provider]").textContent = provider;
    const consent = element("[data-model-consent]");
    const consentLabel =
      status === null
        ? "正在读取模型联网许可"
        : !status.globallyEnabled
          ? "语见已停用"
          : status.modelConsentGranted
            ? "已允许模型联网"
            : "未允许模型联网";
    consent.textContent = "";
    consent.setAttribute("aria-label", consentLabel);
    consent.title = consentLabel;
    consent.dataset.state =
      status === null || !status.globallyEnabled
        ? "inactive"
        : status.modelConsentGranted
          ? "allowed"
          : "blocked";
    const toggle = element<HTMLInputElement>("[data-site-enabled]");
    toggle.checked = this.sitePolicy?.enabled ?? false;
    toggle.disabled =
      this.busy.has("site") ||
      this.sitePolicy === null ||
      this.status === null ||
      !this.status.globallyEnabled;
    const globalToggle = element<HTMLInputElement>("[data-global-enabled]");
    globalToggle.checked = status?.globallyEnabled ?? false;
    globalToggle.disabled = this.busy.has("global") || status === null;
    element<HTMLButtonElement>("[data-toggle-appearance]").disabled = this.busy.has("appearance");
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-popup-theme]")) {
      button.setAttribute("aria-pressed", String(button.dataset.popupTheme === appearance));
      button.disabled = this.busy.has("appearance");
    }
    document.body.dataset.overlayTheme = status?.overlayTheme ?? "pearl";
    element("[data-site-host]").textContent = this.unsupportedTab
      ? "当前标签页不支持语见"
      : (this.sitePolicy?.host ?? "正在读取当前页面…");
    document.body.setAttribute("aria-busy", "false");
    renderPopupOutbox(
      this.submissionOutbox,
      this.submissionOutboxUnavailable,
      this.busy.has("outbox"),
      this.outboxClearConfirmation,
    );
    if (this.focusOutboxAfterRender) {
      this.focusOutboxAfterRender = false;
      element("[data-popup-status]").focus();
    }
  }

  private setPageStatus(message: string, tone: "error" | "neutral" | "success"): void {
    const status = element("[data-popup-status]");
    status.textContent = message;
    status.dataset.tone = tone;
  }
}
