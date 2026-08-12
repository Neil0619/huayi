import type {
  StoreOverlayController,
  StoreOverlayAnchor,
} from "./overlay/store-overlay-controller.js";
import type { StoreSitePolicyResponse } from "@huayi/store-domain";
import { readStoreSelection } from "./selection/read-selection.js";

export class StoreContentApp {
  private started = false;

  constructor(
    private readonly document: Document,
    private readonly overlay: StoreOverlayController,
    private readonly acceptsUserGesture: (event: Event) => boolean = (event) => event.isTrusted,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.document.addEventListener("mouseup", this.onPointerSelection);
    this.document.addEventListener("keyup", this.onKeyboardSelection);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.document.removeEventListener("mouseup", this.onPointerSelection);
    this.document.removeEventListener("keyup", this.onKeyboardSelection);
    this.overlay.close();
  }

  update(policy: StoreSitePolicyResponse): void {
    this.overlay.setDefaultAction(policy.defaultAction);
    this.overlay.setTheme(policy.overlayTheme);
  }

  private showCurrentSelection(pointerLeft?: number): void {
    const reading = readStoreSelection(this.document.getSelection());
    if (reading === null) {
      this.overlay.close();
      return;
    }
    const rangeWithRect = reading.range as Range & {
      getBoundingClientRect?: () => { bottom: number; left: number; top: number };
    };
    const rect = rangeWithRect.getBoundingClientRect?.();
    const anchor: StoreOverlayAnchor = {
      bottom: rect?.bottom ?? 24,
      left: pointerLeft === undefined || pointerLeft <= 0 ? (rect?.left ?? 12) : pointerLeft,
      top: rect?.top ?? 12,
    };
    this.overlay.show(reading, anchor);
  }

  private cameFromOverlay(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (target) =>
          target instanceof Element &&
          target.closest("[data-huayi-store-overlay], [data-huayi-store-youtube-subtitles]") !==
            null,
      );
  }

  private readonly onPointerSelection = (event: MouseEvent): void => {
    if (!this.acceptsUserGesture(event) || this.cameFromOverlay(event)) return;
    this.showCurrentSelection(event.clientX);
  };

  private readonly onKeyboardSelection = (event: KeyboardEvent): void => {
    if (!this.acceptsUserGesture(event) || event.key === "Escape" || this.cameFromOverlay(event)) {
      return;
    }
    this.showCurrentSelection();
  };
}
