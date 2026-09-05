import type { StoreOverlayAnchor } from "./overlay-runtime.js";
import { positionOverlayHost } from "./overlay-visual-state.js";

export class OverlayInteractionLifecycle {
  #anchor: StoreOverlayAnchor | null = null;
  #host: HTMLElement | null = null;
  #range: Range | undefined;
  #rangeOrigin: { readonly left: number; readonly top: number } | null = null;
  #scrollX = 0;
  #scrollY = 0;
  #listeners: AbortController | null = null;

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
    const view = this.#document.defaultView;
    this.#scrollX = view?.scrollX ?? 0;
    this.#scrollY = view?.scrollY ?? 0;
    this.#listeners = new (view?.AbortController ?? AbortController)();
    const options = { capture: true, signal: this.#listeners.signal };
    this.#document.addEventListener("keydown", this.#onDocumentKeyDown, options);
    this.#document.addEventListener("pointerdown", this.#onDocumentPointerDown, options);
    this.#document.addEventListener("scroll", this.#onViewportChange, options);
    view?.addEventListener("resize", this.#onViewportChange, options);
    view?.visualViewport?.addEventListener("resize", this.#onViewportChange, options);
    view?.visualViewport?.addEventListener("scroll", this.#onViewportChange, options);
    this.position();
  }

  position(): void {
    if (this.#host !== null && this.#anchor !== null) {
      const view = this.#document.defaultView;
      const bounds = this.#range?.getBoundingClientRect?.();
      // Track document/container movement without replacing the user's mouse anchor.
      const origin = bounds && (bounds.width || bounds.height) ? this.#rangeOrigin : null;
      const offsetX =
        origin && bounds ? bounds.left - origin.left : this.#scrollX - (view?.scrollX ?? 0);
      const offsetY =
        origin && bounds ? bounds.top - origin.top : this.#scrollY - (view?.scrollY ?? 0);
      positionOverlayHost(this.#host, {
        left: this.#anchor.left + offsetX,
        top: this.#anchor.top + offsetY,
        bottom: this.#anchor.bottom + offsetY,
      });
    }
  }

  stop(): void {
    this.#listeners?.abort();
    this.#listeners = null;
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
