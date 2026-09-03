import {
  STORE_MESSAGE_VERSION,
  parseCloudSessionResponse,
  parseSubmissionOutboxResponse,
  parseStorePopupStatusResponse,
  parseStoreSitePolicyResponse,
  type StorePopupStatusResponse,
  type StoreSitePolicyResponse,
  type CloudSessionResponse,
  type SubmissionOutboxResponse,
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
  private cloudSession: CloudSessionResponse | null = null;
  private cloudUnavailable = false;
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
    element<HTMLButtonElement>("[data-cloud-session-action]").addEventListener("click", () => {
      void this.execute(async () => this.toggleCloudSession());
    });
    element<HTMLButtonElement>("[data-submission-outbox-retry]").addEventListener("click", () => {
      void this.execute(async () => this.retrySubmissionOutbox());
    });
    element<HTMLButtonElement>("[data-submission-outbox-clear]").addEventListener("click", () => {
      if (!this.outboxClearConfirmation) {
        this.outboxClearConfirmation = true;
        this.setPageStatus("再次点击只清空本机待提交学习采集。", "neutral");
        this.render();
        return;
      }
      void this.execute(async () => this.clearSubmissionOutbox());
    });
    await this.execute(async () => {
      const [status, tab, cloudSession, submissionOutbox] = await Promise.all([
        this.dependencies.sendRuntimeMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/popup-status",
        }),
        this.dependencies.queryActiveTab(),
        this.dependencies
          .sendRuntimeMessage({
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/cloud-session-status",
          })
          .then((value) => parseCloudSessionResponse(value))
          .catch(() => null),
        this.dependencies
          .sendRuntimeMessage({
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/submission-outbox-status",
          })
          .then((value) => parseSubmissionOutboxResponse(value))
          .catch(() => null),
      ]);
      this.status = parseStorePopupStatusResponse(status);
      this.cloudSession = cloudSession;
      this.cloudUnavailable = cloudSession === null;
      this.submissionOutbox = submissionOutbox;
      this.submissionOutboxUnavailable = submissionOutbox === null;
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

  private async toggleCloudSession(): Promise<void> {
    if (this.cloudSession === null) throw new PopupPageError("云端连接状态尚未就绪。");
    const type =
      this.cloudSession.status === "connected"
        ? "store/cloud-session-disconnect"
        : "store/cloud-session-start";
    try {
      this.cloudSession = parseCloudSessionResponse(
        await this.dependencies.sendRuntimeMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type,
        }),
      );
    } catch (error) {
      if (type === "store/cloud-session-disconnect") {
        throw new PopupPageError("暂时无法安全断开；本机会话仍保留，请联网后重试。");
      }
      throw error;
    }
    await this.readSubmissionOutbox();
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
        return "已提交到云端待整理。";
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
    return "只清除了本机待提交学习采集，云端已有记录不受影响。";
  }

  private async openOptions(): Promise<void> {
    try {
      await this.dependencies.openOptionsPage();
    } catch {
      throw new PopupPageError("无法打开设置页，请稍后重试。");
    }
  }

  private async execute(operation: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setPageStatus("", "neutral");
    this.render();
    try {
      const result = await operation();
      const message = typeof result === "string" ? result : undefined;
      this.setPageStatus(message ?? "", message === undefined ? "neutral" : "success");
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
    document.documentElement.dataset.appearance = status?.appearance ?? "silver";
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
      ? "当前标签页不支持语见"
      : (this.sitePolicy?.host ?? "正在读取当前页面…");
    document.body.setAttribute("aria-busy", String(this.busy));
    const cloudAction = element<HTMLButtonElement>("[data-cloud-session-action]");
    const cloudStatus = this.cloudSession?.status;
    element("[data-cloud-session-state]").textContent = this.cloudUnavailable
      ? "状态读取失败"
      : cloudStatus === "not-configured"
        ? "此安装包未接入语见云端"
        : cloudStatus === "connected"
          ? "已登录并连接"
          : cloudStatus === "pairing"
            ? "请在网页完成登录"
            : cloudStatus === "expired"
              ? "登录已过期"
              : "尚未登录";
    cloudAction.textContent = cloudStatus === "connected" ? "断开此设备" : "登录并连接";
    cloudAction.disabled =
      this.busy ||
      this.cloudUnavailable ||
      cloudStatus === undefined ||
      cloudStatus === "not-configured" ||
      cloudStatus === "pairing";
    const submissionOutbox = this.submissionOutbox;
    const outboxState = submissionOutbox?.state;
    const queuedLabel =
      submissionOutbox?.state === "queued"
        ? `${submissionOutbox.count} 条学习采集等待提交（最早 ${submissionOutbox.oldestQueuedAt.slice(0, 10)}）`
        : null;
    const unconfiguredLabel =
      submissionOutbox?.state === "not-configured" && "count" in submissionOutbox
        ? `此安装包未接入云端提交；${submissionOutbox.count} 条学习采集仍加密保存在本机（最早 ${submissionOutbox.oldestQueuedAt.slice(0, 10)}）`
        : null;
    const outboxLabel = element("[data-submission-outbox-state]");
    outboxLabel.textContent = this.submissionOutboxUnavailable
      ? "待提交学习采集状态读取失败"
      : outboxState === "not-configured"
        ? (unconfiguredLabel ?? "此安装包未接入云端提交")
        : outboxState === "upload-disabled"
          ? "模型联网同意已关闭"
          : outboxState === "session-unavailable"
            ? "连接云端后可提交"
            : outboxState === "client-upgrade-required"
              ? "请先更新语见；待提交学习采集仍加密保存在本机"
              : queuedLabel !== null
                ? queuedLabel
                : "没有待提交学习采集";
    outboxLabel.dataset.state = outboxState ?? "unavailable";
    const hasStored =
      outboxState === "client-upgrade-required" ||
      outboxState === "queued" ||
      (outboxState === "not-configured" &&
        submissionOutbox !== null &&
        "count" in submissionOutbox);
    element<HTMLElement>(".outbox-actions").hidden = !hasStored;
    element<HTMLButtonElement>("[data-submission-outbox-retry]").disabled =
      this.busy || outboxState !== "queued";
    const clear = element<HTMLButtonElement>("[data-submission-outbox-clear]");
    clear.textContent = this.outboxClearConfirmation ? "确认清空" : "清空";
    clear.disabled = this.busy || !hasStored;
    if (this.focusOutboxAfterRender) {
      this.focusOutboxAfterRender = false;
      outboxLabel.focus();
    }
  }

  private setPageStatus(message: string, tone: "error" | "neutral" | "success"): void {
    const status = element("[data-popup-status]");
    status.textContent = message;
    status.dataset.tone = tone;
  }
}
