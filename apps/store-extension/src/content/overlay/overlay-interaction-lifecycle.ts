import type { StoreOverlayAnchor } from "./overlay-runtime.js";
import { positionOverlayHost } from "./overlay-visual-state.js";

export class OverlayInteractionLifecycle {
  private anchor: StoreOverlayAnchor | null = null;
  private host: HTMLElement | null = null;

  constructor(
    private readonly document: Document,
    private readonly acceptsUserGesture: (event: Event) => boolean,
    private readonly dismiss: () => void,
  ) {}

  start(host: HTMLElement, anchor: StoreOverlayAnchor): void {
    this.stop();
    this.host = host;
    this.anchor = anchor;
    this.document.addEventListener("keydown", this.onDocumentKeyDown, true);
    this.document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.document.addEventListener("scroll", this.dismiss, true);
    this.document.defaultView?.addEventListener("resize", this.dismiss);
    this.position();
  }

  position(): void {
    if (this.host !== null && this.anchor !== null) {
      positionOverlayHost(this.host, this.anchor);
    }
  }

  stop(): void {
    this.document.removeEventListener("keydown", this.onDocumentKeyDown, true);
    this.document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.document.removeEventListener("scroll", this.dismiss, true);
    this.document.defaultView?.removeEventListener("resize", this.dismiss);
    this.host = null;
    this.anchor = null;
  }

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.host === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.dismiss();
  };

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (
      this.host === null ||
      event.composedPath().includes(this.host) ||
      !this.acceptsUserGesture(event)
    ) {
      return;
    }
    this.dismiss();
  };
}
