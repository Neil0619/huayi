import {
  STORE_MESSAGE_VERSION,
  parseStoreContentSettingsResponse,
  type StoreAppearance,
  type StoreKeyboardShortcut,
  type StoreContentSettingsRequest,
  type StoreSitePolicyResponse,
  type YouTubeMode,
} from "@huayi/store-domain";

import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { YouTubeBridgeClient } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";
import { isExactYouTubeWatchPage, videoIdFromYouTubeLocation } from "./youtube-location.js";
import {
  createYouTubeStartupRetryExecutor,
  type YouTubeStartupRetryExecutor,
} from "./youtube-startup-retry.js";

interface YouTubeController {
  setAppearance?(appearance: StoreAppearance): void;
  start(): void;
  stop(): void;
}

interface YouTubeIntegrationOptions {
  readonly createController?: (
    mode: Exclude<YouTubeMode, "disabled">,
    shortcut: StoreKeyboardShortcut | null,
    appearance: StoreAppearance,
  ) => YouTubeController;
  readonly createRandomId?: () => string;
  readonly document?: Document;
  readonly isWatchPage?: () => boolean;
  readonly overlay: StoreOverlayController;
  readonly runStartupStep?: YouTubeStartupRetryExecutor;
  readonly sendMessage: (message: StoreContentSettingsRequest) => Promise<unknown>;
  readonly waitForStartupRetry?: () => Promise<void>;
}

export class YouTubeIntegration {
  private activation = 0;
  private appearance: StoreAppearance = "silver";
  private controller: YouTubeController | null = null;
  private readonly createController: (
    mode: Exclude<YouTubeMode, "disabled">,
    shortcut: StoreKeyboardShortcut | null,
    appearance: StoreAppearance,
  ) => YouTubeController;
  private readonly createRandomId: () => string;
  private readonly documentRef: Document;
  private readonly isWatchPage: () => boolean;
  private readonly options: YouTubeIntegrationOptions;
  private readonly runStartupStep: YouTubeStartupRetryExecutor;
  private initializingActivation: number | null = null;
  private started = false;

  constructor(options: YouTubeIntegrationOptions) {
    this.options = options;
    this.documentRef = options.document ?? document;
    this.createRandomId = options.createRandomId ?? (() => crypto.randomUUID());
    this.isWatchPage =
      options.isWatchPage ?? (() => isExactYouTubeWatchPage(this.documentRef.location));
    this.runStartupStep =
      options.runStartupStep ??
      createYouTubeStartupRetryExecutor(
        options.waitForStartupRetry === undefined
          ? {}
          : { waitForRetry: options.waitForStartupRetry },
      );
    this.createController =
      options.createController ??
      ((mode, shortcut, appearance) => {
        const bridge = new YouTubeBridgeClient({
          capability: this.createRandomId(),
          channel: this.createRandomId(),
          document: this.documentRef,
          getCurrentVideoId: () => videoIdFromYouTubeLocation(this.documentRef.location),
        });
        return new YouTubeCaptionController({
          bridge,
          document: this.documentRef,
          appearance,
          mode,
          overlay: this.options.overlay,
          shortcut,
        });
      });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.documentRef.addEventListener("yt-navigate-start", this.handleNavigationStart);
    this.documentRef.addEventListener("yt-navigate-finish", this.handleNavigationFinish);
    this.requestInitialization();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.documentRef.removeEventListener("yt-navigate-start", this.handleNavigationStart);
    this.documentRef.removeEventListener("yt-navigate-finish", this.handleNavigationFinish);
    this.deactivate();
  }

  update(policy: StoreSitePolicyResponse): void {
    this.appearance = policy.appearance;
    this.options.overlay.setAppearance(policy.appearance);
    this.options.overlay.setDefaultAction(policy.defaultAction);
    this.options.overlay.setTheme(policy.overlayTheme);
    this.controller?.setAppearance?.(policy.appearance);
  }

  private readonly handleNavigationFinish = (): void => {
    this.requestInitialization();
  };

  private readonly handleNavigationStart = (): void => {
    this.deactivate();
  };

  private deactivate(): void {
    this.activation += 1;
    this.initializingActivation = null;
    this.controller?.stop();
    this.controller = null;
  }

  private requestInitialization(): void {
    if (
      !this.started ||
      this.controller !== null ||
      this.initializingActivation !== null ||
      !this.isWatchPage()
    ) {
      return;
    }
    const activation = ++this.activation;
    this.initializingActivation = activation;
    void this.initialize(activation)
      .catch(() => undefined)
      .finally(() => {
        if (this.initializingActivation === activation) this.initializingActivation = null;
      });
  }

  private isCurrentActivation(activation: number): boolean {
    return (
      this.started &&
      activation === this.activation &&
      this.controller === null &&
      this.isWatchPage()
    );
  }

  private async initialize(activation: number): Promise<void> {
    const request: StoreContentSettingsRequest = {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/content-settings",
    };
    const response = await this.runStartupStep(async () => {
      if (!this.isCurrentActivation(activation)) return null;
      return parseStoreContentSettingsResponse(await this.options.sendMessage(request));
    });
    if (
      response === null ||
      !this.isCurrentActivation(activation) ||
      response.youtubeMode === "disabled"
    ) {
      return;
    }
    this.appearance = response.appearance;
    this.options.overlay.setAppearance(response.appearance);
    this.controller = this.createController(
      response.youtubeMode,
      response.youtubeShortcut,
      this.appearance,
    );
    this.controller.start();
  }
}
