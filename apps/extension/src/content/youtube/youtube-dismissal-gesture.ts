import { isPlayerBlankPointerTarget } from "./youtube-player-state.js";

interface YouTubeDismissalGestureOptions {
  canDismiss(): boolean;
  dismiss(): void;
  getPlayer(): HTMLElement | null;
}

export class YouTubeDismissalGesture {
  private pendingClickTarget: EventTarget | null = null;

  constructor(private readonly options: YouTubeDismissalGestureOptions) {}

  readonly handlePointerDown = (event: PointerEvent): void => {
    this.pendingClickTarget = null;
    const player = this.options.getPlayer();
    if (
      !this.options.canDismiss() ||
      player === null ||
      !isPlayerBlankPointerTarget(event, player)
    ) {
      return;
    }
    this.pendingClickTarget = event.target;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.options.dismiss();
  };

  readonly handleClick = (event: MouseEvent): void => {
    const pendingTarget = this.pendingClickTarget;
    this.pendingClickTarget = null;
    if (pendingTarget === null || event.target !== pendingTarget) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  clear(): void {
    this.pendingClickTarget = null;
  }
}
