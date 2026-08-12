const EXCLUDED_BLANK_SELECTOR = [
  ".ytp-chrome-controls",
  ".ytp-popup",
  ".ytp-settings-menu",
  "[data-huayi-store-youtube-subtitles]",
  "[data-huayi-store-youtube-control-host]",
  "[data-huayi-store-overlay]",
].join(",");

interface YouTubeDismissalGestureOptions {
  readonly canDismiss: () => boolean;
  readonly dismiss: () => void;
  readonly getPlayer: () => HTMLElement | null;
}

function isPlayerBlankPointerTarget(event: Event, player: HTMLElement): boolean {
  return (
    event.target instanceof Element &&
    player.contains(event.target) &&
    event.target.closest(EXCLUDED_BLANK_SELECTOR) === null
  );
}

/** Consumes both halves of the one player activation used to dismiss a caption selection. */
export class YouTubeDismissalGesture {
  readonly #options: YouTubeDismissalGestureOptions;
  #pendingClickTarget: EventTarget | null = null;

  constructor(options: YouTubeDismissalGestureOptions) {
    this.#options = options;
  }

  readonly handlePointerDown = (event: PointerEvent): void => {
    this.#pendingClickTarget = null;
    const player = this.#options.getPlayer();
    if (
      !this.#options.canDismiss() ||
      player === null ||
      !isPlayerBlankPointerTarget(event, player)
    ) {
      return;
    }
    this.#pendingClickTarget = event.target;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#options.dismiss();
  };

  readonly handleClick = (event: MouseEvent): void => {
    const pendingTarget = this.#pendingClickTarget;
    this.#pendingClickTarget = null;
    if (pendingTarget === null || event.target !== pendingTarget) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  clear(): void {
    this.#pendingClickTarget = null;
  }
}
