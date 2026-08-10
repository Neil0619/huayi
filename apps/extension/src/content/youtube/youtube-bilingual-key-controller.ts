import { hasDocumentSelection, hasEditableFocus } from "./youtube-player-state.js";
import { DEFAULT_YOUTUBE_SHORTCUT, type KeyboardShortcut } from "../../settings/settings-domain.js";

interface YouTubeBilingualKeyControllerOptions {
  canHold: () => boolean;
  setHolding: (value: boolean) => void;
  shortcut?: KeyboardShortcut | null;
}

function consumeTemporaryBilingualKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isShortcutKey(event: KeyboardEvent, shortcut: KeyboardShortcut | null): boolean {
  return shortcut !== null && event.code === shortcut.code;
}

function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut | null): boolean {
  return (
    isShortcutKey(event, shortcut) &&
    shortcut !== null &&
    event.altKey === shortcut.alt &&
    event.ctrlKey === shortcut.ctrl &&
    event.metaKey === shortcut.meta &&
    event.shiftKey === shortcut.shift
  );
}

export class YouTubeBilingualKeyController {
  private claimedPress = false;

  constructor(
    private readonly documentRef: Document,
    private readonly options: YouTubeBilingualKeyControllerOptions,
  ) {}

  readonly handleKeydown = (event: KeyboardEvent): void => {
    const shortcut =
      this.options.shortcut === undefined ? DEFAULT_YOUTUBE_SHORTCUT : this.options.shortcut;
    if (this.claimedPress && isShortcutKey(event, shortcut)) {
      consumeTemporaryBilingualKey(event);
      return;
    }
    if (!matchesShortcut(event, shortcut)) return;
    if (hasDocumentSelection(this.documentRef) || hasEditableFocus(this.documentRef)) {
      return;
    }
    if (event.repeat) return;
    if (!this.options.canHold()) return;
    this.claimedPress = true;
    consumeTemporaryBilingualKey(event);
    this.options.setHolding(true);
  };

  readonly handleKeyup = (event: KeyboardEvent): void => {
    if (
      !isShortcutKey(
        event,
        this.options.shortcut === undefined ? DEFAULT_YOUTUBE_SHORTCUT : this.options.shortcut,
      ) ||
      !this.claimedPress
    )
      return;
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
