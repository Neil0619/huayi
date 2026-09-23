import type { StoreOverlayController } from "./overlay/store-overlay-controller.js";
import type { StoreSitePolicyResponse } from "@huayi/store-domain";
import { readStoreSelection } from "./selection/read-selection.js";
import {
  selectionOverlayAnchor,
  type SelectionPointer,
} from "./overlay/selection-overlay-anchor.js";

const OWN_SELECTION =
  "[data-huayi-store-overlay], [data-huayi-store-youtube-subtitles], [data-huayi-store-youtube-control-host], [data-huayi-store-asbplayer], [data-huayi-store-asbplayer-control]";

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
    const selection = this.document.getSelection();
    const nodes = [selection?.anchorNode, selection?.focusNode];
    if (
      nodes.some((node) =>
        (node instanceof Element ? node : node?.parentElement)?.closest(OWN_SELECTION),
      )
    )
      return true;
    return event
      .composedPath()
      .some((target) => target instanceof Element && target.closest(OWN_SELECTION) !== null);
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
