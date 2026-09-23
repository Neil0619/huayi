import {
  STORE_MESSAGE_VERSION,
  parseStoreAsbplayerSettingsResponse,
  type StoreAsbplayerSettingsRequest,
  type StoreAsbplayerSettingsResponse,
  type StoreSitePolicyResponse,
  type StoreAppearance,
} from "@huayi/store-domain";
import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { AsbplayerBridgeClient } from "./asbplayer-bridge-client.js";
import { AsbplayerController } from "./asbplayer-controller.js";
import { readAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { createYouTubeStartupRetryExecutor } from "../youtube/youtube-startup-retry.js";
interface Controller {
  start(): void;
  stop(): void;
  setAppearance(appearance: StoreAppearance): void;
  updatePreferences?(settings: StoreAsbplayerSettingsResponse): void;
}
export class AsbplayerIntegration {
  private started = false;
  private generation = 0;
  private controller: Controller | null = null;
  private settingsKey = "";
  private cleared = false;
  private suspended = false;
  private failure: HTMLElement | null = null;
  private readonly startupRetry = createYouTubeStartupRetryExecutor();
  constructor(
    private readonly options: {
      readonly document: Document;
      readonly overlay: StoreOverlayController;
      readonly sendMessage: (request: StoreAsbplayerSettingsRequest) => Promise<unknown>;
      readonly createController?: (settings: StoreAsbplayerSettingsResponse) => Controller;
      readonly disableMain?: () => void;
      readonly isPlayer?: () => boolean;
    },
  ) {}
  start(): void {
    if (this.started) return;
    this.started = true;
    this.suspended = false;
    this.options.document.defaultView?.addEventListener("pagehide", this.pageHide);
    this.options.document.defaultView?.addEventListener("pageshow", this.pageShow);
    this.clearFailure();
    this.refresh();
  }
  stop(): void {
    this.started = false;
    this.generation += 1;
    this.options.document.defaultView?.removeEventListener("pagehide", this.pageHide);
    this.options.document.defaultView?.removeEventListener("pageshow", this.pageShow);
    this.clearFailure();
    this.deactivate();
  }
  private readonly pageHide = (): void => {
    this.suspended = true;
    this.generation += 1;
    this.clearFailure();
    this.deactivate();
  };
  private readonly pageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted || !this.started || !this.suspended) return;
    this.suspended = false;
    this.cleared = false;
    this.refresh();
  };
  private clearFailure(): void {
    this.failure?.remove();
    this.failure = null;
  }
  private showFailure(): void {
    this.clearFailure();
    const status = this.options.document.createElement("div");
    status.dataset.huayiAsbplayerStartupError = "";
    status.setAttribute("role", "status");
    status.textContent = "语见设置暂不可用，已保留原字幕。请重新加载播放器后重试。";
    status.style.cssText =
      "position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483000;padding:12px;background:#222;color:white;font:14px/1.5 system-ui";
    (this.options.document.body ?? this.options.document.documentElement).append(status);
    this.failure = status;
  }
  update(policy: StoreSitePolicyResponse): void {
    this.options.overlay.setAppearance(policy.appearance);
    this.options.overlay.setDefaultAction(policy.defaultAction);
    this.options.overlay.setTheme(policy.overlayTheme);
    if (!policy.enabled) {
      this.stop();
      return;
    }
    this.controller?.setAppearance(policy.appearance);
    if (this.started) this.refresh();
  }
  private deactivate(): void {
    const hadController = this.controller !== null;
    this.controller?.stop();
    this.controller = null;
    this.settingsKey = "";
    if (hadController) this.cleared = true;
    if (this.cleared) return;
    this.cleared = true;
    if (this.options.disableMain) {
      this.options.disableMain();
      return;
    }
    const view = this.options.document.defaultView;
    if (view) {
      const bridge = new AsbplayerBridgeClient(view);
      bridge.start();
      bridge.destroy();
    }
  }
  private refresh(): void {
    if (this.suspended) return;
    const view = this.options.document.defaultView;
    if (!view || !(this.options.isPlayer?.() ?? readAsbplayerPlaybackContext(view) !== null)) {
      this.deactivate();
      return;
    }
    const generation = ++this.generation;
    const current = () => this.started && !this.suspended && generation === this.generation;
    const read = () =>
      current()
        ? this.options.sendMessage({
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/asbplayer-settings",
          })
        : Promise.resolve(null);
    // Only transport failures during startup are retried. Protocol parsing and authority
    // decisions stay outside the retry, and an active layer fails closed immediately.
    void (this.controller ? read() : this.startupRetry(read))
      .then((raw) => {
        if (!current()) return;
        const settings = parseStoreAsbplayerSettingsResponse(raw);
        this.clearFailure();
        if (settings.asbplayerMode === "disabled") {
          this.deactivate();
          return;
        }
        const key = JSON.stringify([settings.asbplayerMode, settings.asbplayerShortcut]);
        if (this.controller && (key === this.settingsKey || this.controller.updatePreferences)) {
          this.controller.updatePreferences?.(settings);
          this.controller.setAppearance(settings.appearance);
          this.settingsKey = key;
          return;
        }
        this.controller?.stop();
        this.controller = null;
        this.cleared = false;
        this.settingsKey = key;
        this.controller =
          this.options.createController?.(settings) ??
          new AsbplayerController({
            document: this.options.document,
            bridge: new AsbplayerBridgeClient(view),
            mode: settings.asbplayerMode,
            shortcut: settings.asbplayerShortcut,
            appearance: settings.appearance,
            overlay: this.options.overlay,
          });
        this.controller.start();
      })
      .catch(() => {
        if (!current()) return;
        this.deactivate();
        this.showFailure();
      });
  }
}
