import type { StoreOverlayAnchor } from "./overlay-runtime.js";
import { positionOverlayHost } from "./overlay-visual-state.js";

export class OverlayInteractionLifecycle {
  #anchor: StoreOverlayAnchor | null = null;
  #host: HTMLElement | null = null;
  #range: Range | undefined;
  #rangeOrigin: { readonly left: number; readonly top: number } | null = null;
  #scrollX = 0;
  #scrollY = 0;

  readonly #document: Document;

  readonly #acceptsUserGesture: (event: Event) => boolean;

  readonly #dismiss: () => void;

  constructor(
    document: Document,
    acceptsUserGesture: (event: Event) => boolean,
    dismiss: () => void,
  ) {
    this.#document = document;
    this.#acceptsUserGesture = acceptsUserGesture;
    this.#dismiss = dismiss;
  }

  start(host: HTMLElement, anchor: StoreOverlayAnchor, range?: Range): void {
    this.stop();
    this.#host = host;
    this.#anchor = anchor;
    this.#range = range;
    const bounds = range?.getBoundingClientRect?.();
    this.#rangeOrigin =
      bounds && (bounds.width || bounds.height) ? { left: bounds.left, top: bounds.top } : null;
    this.#scrollX = this.#document.defaultView?.scrollX ?? 0;
    this.#scrollY = this.#document.defaultView?.scrollY ?? 0;
    this.#document.addEventListener("keydown", this.#onDocumentKeyDown, true);
    this.#document.addEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.#document.addEventListener("scroll", this.#onViewportChange, true);
    this.#document.defaultView?.addEventListener("resize", this.#onViewportChange);
    this.#document.defaultView?.visualViewport?.addEventListener("resize", this.#onViewportChange);
    this.#document.defaultView?.visualViewport?.addEventListener("scroll", this.#onViewportChange);
    this.position();
  }

  position(): void {
    if (this.#host !== null && this.#anchor !== null) {
      const view = this.#document.defaultView;
      const bounds = this.#range?.getBoundingClientRect?.();
      const offsetY = (view?.scrollY ?? 0) - this.#scrollY;
      const offsetX = (view?.scrollX ?? 0) - this.#scrollX;
      positionOverlayHost(
        this.#host,
        bounds && (bounds.width || bounds.height) && this.#rangeOrigin
          ? {
              // Track document/container movement without replacing the user's mouse anchor.
              left: this.#anchor.left + bounds.left - this.#rangeOrigin.left,
              top: this.#anchor.top + bounds.top - this.#rangeOrigin.top,
              bottom: this.#anchor.bottom + bounds.top - this.#rangeOrigin.top,
            }
          : {
              left: this.#anchor.left - offsetX,
              top: this.#anchor.top - offsetY,
              bottom: this.#anchor.bottom - offsetY,
            },
      );
    }
  }

  stop(): void {
    this.#document.removeEventListener("keydown", this.#onDocumentKeyDown, true);
    this.#document.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.#document.removeEventListener("scroll", this.#onViewportChange, true);
    this.#document.defaultView?.removeEventListener("resize", this.#onViewportChange);
    this.#document.defaultView?.visualViewport?.removeEventListener(
      "resize",
      this.#onViewportChange,
    );
    this.#document.defaultView?.visualViewport?.removeEventListener(
      "scroll",
      this.#onViewportChange,
    );
    this.#host = null;
    this.#anchor = null;
    this.#range = undefined;
    this.#rangeOrigin = null;
  }

  readonly #onViewportChange = (event: Event): void => {
    if (this.#host && !event.composedPath().includes(this.#host)) this.position();
  };

  readonly #onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.#host === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.#dismiss();
  };

  readonly #onDocumentPointerDown = (event: PointerEvent): void => {
    if (
      this.#host === null ||
      event.composedPath().includes(this.#host) ||
      !this.#acceptsUserGesture(event)
    ) {
      return;
    }
    this.#dismiss();
  };
}
