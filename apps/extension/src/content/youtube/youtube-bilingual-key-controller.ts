import { hasDocumentSelection, hasEditableFocus } from "./youtube-player-state.js";

interface YouTubeBilingualKeyControllerOptions {
  canHold: () => boolean;
  setHolding: (value: boolean) => void;
}

function consumeTemporaryBilingualKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isPhysicalZ(event: KeyboardEvent): boolean {
  return event.code === "KeyZ";
}

function isTemporaryBilingualKeydown(event: KeyboardEvent): boolean {
  return isPhysicalZ(event) && event.shiftKey;
}

function isUnmodifiedTemporaryBilingualKey(event: KeyboardEvent): boolean {
  return isTemporaryBilingualKeydown(event) && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export class YouTubeBilingualKeyController {
  private claimedPress = false;

  constructor(
    private readonly documentRef: Document,
    private readonly options: YouTubeBilingualKeyControllerOptions,
  ) {}

  readonly handleKeydown = (event: KeyboardEvent): void => {
    if (this.claimedPress && isPhysicalZ(event)) {
      consumeTemporaryBilingualKey(event);
      return;
    }
    if (!isTemporaryBilingualKeydown(event)) return;
    if (
      !isUnmodifiedTemporaryBilingualKey(event) ||
      hasDocumentSelection(this.documentRef) ||
      hasEditableFocus(this.documentRef)
    ) {
      return;
    }
    if (event.repeat) return;
    if (!this.options.canHold()) return;
    this.claimedPress = true;
    consumeTemporaryBilingualKey(event);
    this.options.setHolding(true);
  };

  readonly handleKeyup = (event: KeyboardEvent): void => {
    if (!isPhysicalZ(event) || !this.claimedPress) return;
    this.claimedPress = false;
    consumeTemporaryBilingualKey(event);
    this.options.setHolding(false);
  };

  readonly handleBlur = (): void => {
    this.claimedPress = false;
    this.options.setHolding(false);
  };

  readonly handleVisibilityChange = (): void => {
    if (this.documentRef.visibilityState !== "hidden") return;
    this.claimedPress = false;
    this.options.setHolding(false);
  };

  clear(): void {
    this.claimedPress = false;
    this.options.setHolding(false);
  }
}
