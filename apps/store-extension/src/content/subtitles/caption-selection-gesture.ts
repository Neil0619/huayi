interface CaptionSelectionGestureOptions {
  readonly acceptsUserGesture: (event: Event) => boolean;
  readonly canCommit: () => boolean;
  readonly commit: () => void;
  readonly document: Document;
  readonly getEnglish: () => HTMLElement | null;
  readonly hasValidSelection: () => boolean;
  readonly restore: () => void;
}

export class CaptionSelectionGesture {
  readonly #acceptsUserGesture: (event: Event) => boolean;
  readonly #canCommit: () => boolean;
  readonly #commit: () => void;
  readonly #documentRef: Document;
  readonly #getEnglish: () => HTMLElement | null;
  readonly #hasValidSelection: () => boolean;
  readonly #restore: () => void;
  #listeners: AbortController | null = null;
  #active = false;
  #changed = false;
  #pendingFinish = false;
  #pointerId: number | null = null;
  #revision = 0;

  constructor(options: CaptionSelectionGestureOptions) {
    this.#acceptsUserGesture = options.acceptsUserGesture;
    this.#canCommit = options.canCommit;
    this.#commit = options.commit;
    this.#documentRef = options.document;
    this.#getEnglish = options.getEnglish;
    this.#hasValidSelection = options.hasValidSelection;
    this.#restore = options.restore;
  }

  get active(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#listeners !== null) return;
    const view = this.#documentRef.defaultView;
    this.#listeners = new (view?.AbortController ?? AbortController)();
    const options = { capture: true, signal: this.#listeners.signal };
    this.#documentRef.addEventListener("pointerdown", this.handlePointerDown, options);
    this.#documentRef.addEventListener("pointercancel", this.handlePointerCancel, options);
    this.#documentRef.addEventListener("mouseup", this.handleMouseup, options);
    this.#documentRef.addEventListener("selectionchange", this.handleSelectionChange, {
      signal: this.#listeners.signal,
    });
    view?.addEventListener("pointerup", this.handlePointerUp, options);
  }

  stop(): void {
    this.#listeners?.abort();
    this.#listeners = null;
    this.clear();
  }

  clear(): void {
    this.#revision += 1;
    this.#active = false;
    this.#changed = false;
    this.#pendingFinish = false;
    this.#pointerId = null;
  }

  readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.#acceptsUserGesture(event)) return;
    const english = this.#getEnglish();
    if (english === null || !event.composedPath().includes(english)) return;
    this.clear();
    this.#active = true;
    this.#pointerId = event.pointerId;
  };

  readonly handlePointerCancel = (event: PointerEvent): void => {
    if (!this.#active || this.#pointerId !== event.pointerId) return;
    this.clear();
    this.#restore();
  };

  readonly handleSelectionChange = (): void => {
    if (this.#active) this.#changed = this.#hasValidSelection();
  };

  readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.#acceptsUserGesture(event) || !this.#active || this.#pointerId !== event.pointerId)
      return;
    this.#scheduleFinish();
  };

  readonly handleMouseup = (event: MouseEvent): void => {
    if (!this.#acceptsUserGesture(event) || !this.#canCommit()) return;
    if (this.#active) {
      this.#finish();
      return;
    }
    const english = this.#getEnglish();
    if (english !== null && event.composedPath().includes(english)) this.#commit();
  };

  #finish(): void {
    const changed = this.#changed || this.#hasValidSelection();
    this.clear();
    if (changed && this.#canCommit()) this.#commit();
    else this.#restore();
  }

  #scheduleFinish(): void {
    if (this.#pendingFinish) return;
    this.#pendingFinish = true;
    const revision = this.#revision;
    queueMicrotask(() => {
      if (!this.#pendingFinish || this.#revision !== revision || !this.#active) return;
      this.#pendingFinish = false;
      this.#finish();
    });
  }
}
