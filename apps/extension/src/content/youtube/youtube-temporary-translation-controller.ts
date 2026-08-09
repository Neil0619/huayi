import { TemporaryTranslationHold } from "./temporary-translation-hold.js";
import { YouTubeBilingualKeyController } from "./youtube-bilingual-key-controller.js";

export interface YouTubeTemporaryTranslationControllerOptions {
  canHold: () => boolean;
  document: Document;
  setHolding: (holding: boolean) => void;
}

/** Owns every temporary-translation input lifetime and exposes one display decision. */
export class YouTubeTemporaryTranslationController {
  private readonly documentRef: Document;
  private readonly hold: TemporaryTranslationHold;
  private readonly keys: YouTubeBilingualKeyController;

  constructor(options: YouTubeTemporaryTranslationControllerOptions) {
    this.documentRef = options.document;
    this.hold = new TemporaryTranslationHold(options.setHolding);
    this.keys = new YouTubeBilingualKeyController(options.document, {
      canHold: options.canHold,
      setHolding: (holding) => this.hold.set("keyboard", holding),
    });
  }

  readonly handleBlur = (): void => {
    this.keys.handleBlur();
    this.hold.clear();
  };

  readonly handleKeydown = (event: KeyboardEvent): void => this.keys.handleKeydown(event);

  readonly handleKeyup = (event: KeyboardEvent): void => this.keys.handleKeyup(event);

  readonly handleVisibilityChange = (): void => {
    this.keys.handleVisibilityChange();
    if (this.documentRef.visibilityState === "hidden") this.hold.clear();
  };

  setButtonHolding(holding: boolean): void {
    this.hold.set("pointer", holding);
  }

  clear(): void {
    this.keys.clear();
    this.hold.clear();
  }
}
