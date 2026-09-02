import type { StoreAppearance, StoreKeyboardShortcut, YouTubeMode } from "@huayi/store-domain";

import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import type { CaptionBridge } from "./youtube-bridge-client.js";

export interface YouTubeCaptionControllerOptions {
  readonly acceptsUserGesture?: (event: Event) => boolean;
  readonly appearance?: StoreAppearance;
  readonly bridge: CaptionBridge;
  readonly document?: Document;
  readonly getVideoId?: () => string | null;
  readonly isWatchPage?: () => boolean;
  readonly mode: Exclude<YouTubeMode, "disabled">;
  readonly overlay: Pick<StoreOverlayController, "close" | "show">;
  readonly shortcut?: StoreKeyboardShortcut | null;
  readonly waitForTranslatedRetry?: () => Promise<void>;
}
