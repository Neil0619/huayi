import {
  STORE_MESSAGE_VERSION,
  parseCloudSessionResponse,
  type CloudSessionRequest,
  type CloudSessionResponse,
} from "@huayi/store-domain";

interface Dependencies {
  readonly sendMessage: (message: CloudSessionRequest) => Promise<unknown>;
  readonly reportError: (message: string) => void;
  readonly onChanged?: () => Promise<void>;
  readonly subscribe?: (onChanged: () => void) => () => void;
}

/** Both extension pages use the same explicit, server-approved device pairing flow. */
export class CloudAccountControls {
  private session: CloudSessionResponse | null = null;
  private busy = false;
  private unavailable = false;
  private disposed = false;
  private revision = 0;
  private refreshPending = false;
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly action = document.querySelector<HTMLButtonElement>(
    "[data-cloud-session-action]",
  );
  private readonly state = document.querySelector<HTMLElement>("[data-cloud-session-state]");
  private readonly onFocus = () => void this.refresh();
  private readonly onAction = () => void this.change();
  private readonly onPageHide = () => this.dispose();

  constructor(private readonly dependencies: Dependencies) {}

  async initialize(): Promise<void> {
    this.unsubscribe = this.dependencies.subscribe?.(() => {
      this.revision += 1;
      this.refreshPending = true;
      void this.refresh();
    });
    this.action?.addEventListener("click", this.onAction);
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("pagehide", this.onPageHide, { once: true });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.request("store/cloud-session-status");
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    clearTimeout(this.timer);
    this.action?.removeEventListener("click", this.onAction);
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("pagehide", this.onPageHide);
  }

  private async change(): Promise<void> {
    if (this.session?.status === "not-configured") return;
    await this.request(
      this.session?.status === "connected"
        ? "store/cloud-session-disconnect"
        : "store/cloud-session-start",
    );
  }

  private async request(type: CloudSessionRequest["type"]): Promise<void> {
    if (this.busy || this.disposed) return;
    const revision = this.revision;
    this.refreshPending = false;
    clearTimeout(this.timer);
    this.busy = true;
    this.render();
    try {
      const previous = this.session?.status;
      const session = parseCloudSessionResponse(
        await this.dependencies.sendMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type,
        }),
      );
      if (this.disposed || revision !== this.revision) return;
      this.session = session;
      this.unavailable = false;
      if (previous !== undefined && previous !== session.status) {
        void this.dependencies.onChanged?.().catch(() => undefined);
      }
    } catch {
      if (this.disposed || revision !== this.revision) return;
      if (type === "store/cloud-session-status") this.unavailable = true;
      if (type !== "store/cloud-session-status")
        this.dependencies.reportError(
          type === "store/cloud-session-disconnect"
            ? "暂时无法安全断开，连接仍保留。请联网后重试。"
            : type === "store/cloud-session-start"
              ? "无法开始账号关联，请稍后重试。"
              : "账号连接状态读取失败，请重新打开页面重试。",
        );
    } finally {
      this.busy = false;
      if (!this.disposed) {
        this.render();
        if (this.refreshPending) {
          void this.refresh();
        } else if (this.session?.status === "pairing") {
          this.timer = setTimeout(() => void this.refresh(), 1000);
        }
      }
    }
  }

  private render(): void {
    const status = this.session?.status;
    if (this.state)
      this.state.textContent = this.unavailable
        ? "连接状态读取失败"
        : status === "not-configured"
          ? "此安装包不支持账号连接"
          : status === "connected"
            ? "已连接语见云端"
            : status === "pairing"
              ? "等待网页确认关联"
              : status === "expired"
                ? "连接已过期"
                : status === undefined
                  ? "正在读取账号…"
                  : "未连接账号";
    if (this.action) {
      this.action.textContent =
        status === "connected" ? "断开" : status === "pairing" ? "重新打开" : "登录";
      this.action.disabled = this.busy || status === "not-configured";
      this.action.title =
        status === "connected"
          ? "安全断开此设备"
          : status === "pairing"
            ? "重新打开网页，继续确认关联"
            : "登录并关联此插件";
    }
  }
}
