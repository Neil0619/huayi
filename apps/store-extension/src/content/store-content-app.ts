import type { StoreOverlayController } from "./overlay/store-overlay-controller.js";
import type { StoreSitePolicyResponse } from "@huayi/store-domain";
import { readStoreSelection } from "./selection/read-selection.js";
import {
  selectionOverlayAnchor,
  type SelectionPointer,
} from "./overlay/selection-overlay-anchor.js";

export class StoreContentApp {
  #started = false;

  constructor(
    private readonly document: Document,
    private readonly overlay: StoreOverlayController,
    private readonly acceptsUserGesture: (event: Event) => boolean = (event) => event.isTrusted,
  ) {}

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.document.addEventListener("mouseup", this.#onPointerSelection);
    this.document.addEventListener("keyup", this.#onKeyboardSelection);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.document.removeEventListener("mouseup", this.#onPointerSelection);
    this.document.removeEventListener("keyup", this.#onKeyboardSelection);
    this.overlay.close();
  }

  update(policy: StoreSitePolicyResponse): void {
    this.overlay.setAppearance(policy.appearance);
    this.overlay.setDefaultAction(policy.defaultAction);
    this.overlay.setTheme(policy.overlayTheme);
  }

  #showCurrentSelection(pointer?: SelectionPointer): void {
    const reading = readStoreSelection(this.document.getSelection());
    if (reading === null) {
      this.overlay.close();
      return;
    }
    this.overlay.show(reading, selectionOverlayAnchor(reading.range, pointer));
  }

  #cameFromOverlay(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (target) =>
          target instanceof Element &&
          target.closest("[data-huayi-store-overlay], [data-huayi-store-youtube-subtitles]") !==
            null,
      );
  }

  readonly #onPointerSelection = (event: MouseEvent): void => {
    if (!this.acceptsUserGesture(event) || this.#cameFromOverlay(event)) return;
    this.#showCurrentSelection({ x: event.clientX, y: event.clientY });
  };

  readonly #onKeyboardSelection = (event: KeyboardEvent): void => {
    if (!this.acceptsUserGesture(event) || event.key === "Escape" || this.#cameFromOverlay(event)) {
      return;
    }
    this.#showCurrentSelection();
  };
}
