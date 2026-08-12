import type { StoreKeyboardShortcut } from "@huayi/store-domain";

interface YouTubeShortcutOptions {
  readonly canHold: () => boolean;
  readonly setHolding: (holding: boolean) => void;
  readonly shortcut: StoreKeyboardShortcut | null;
}

export function formatYouTubeShortcutLabel(shortcut: StoreKeyboardShortcut | null): string {
  if (shortcut === null) return "";
  const key = shortcut.code.startsWith("Key") ? shortcut.code.slice(3) : shortcut.code;
  return [
    shortcut.ctrl ? "Ctrl" : "",
    shortcut.alt ? "Alt" : "",
    shortcut.shift ? "Shift" : "",
    shortcut.meta ? "Meta" : "",
    key,
  ]
    .filter((part) => part.length > 0)
    .join("+");
}

function editableFocus(documentRef: Document): boolean {
  const active = documentRef.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

function hasSelection(documentRef: Document): boolean {
  const selection = documentRef.defaultView?.getSelection();
  return selection !== undefined && selection !== null && !selection.isCollapsed;
}

function matches(event: KeyboardEvent, shortcut: StoreKeyboardShortcut | null): boolean {
  return (
    shortcut !== null &&
    event.code === shortcut.code &&
    event.altKey === shortcut.alt &&
    event.ctrlKey === shortcut.ctrl &&
    event.metaKey === shortcut.meta &&
    event.shiftKey === shortcut.shift
  );
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export class YouTubeShortcutController {
  private claimed = false;

  constructor(
    private readonly documentRef: Document,
    private readonly options: YouTubeShortcutOptions,
  ) {}

  readonly handleKeydown = (event: KeyboardEvent): void => {
    if (this.claimed && event.code === this.options.shortcut?.code) {
      consume(event);
      return;
    }
    if (
      event.repeat ||
      !matches(event, this.options.shortcut) ||
      editableFocus(this.documentRef) ||
      hasSelection(this.documentRef) ||
      !this.options.canHold()
    ) {
      return;
    }
    this.claimed = true;
    consume(event);
    this.options.setHolding(true);
  };

  readonly handleKeyup = (event: KeyboardEvent): void => {
    if (!this.claimed || event.code !== this.options.shortcut?.code) return;
    this.claimed = false;
    consume(event);
    this.options.setHolding(false);
  };

  readonly clear = (): void => {
    this.claimed = false;
    this.options.setHolding(false);
  };

  readonly handleVisibilityChange = (): void => {
    if (this.documentRef.visibilityState === "hidden") this.clear();
  };
}
