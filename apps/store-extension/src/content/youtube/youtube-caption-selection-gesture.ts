interface YouTubeCaptionSelectionGestureOptions {
  readonly acceptsUserGesture: (event: Event) => boolean;
  readonly canCommit: () => boolean;
  readonly commit: () => void;
  readonly document: Document;
  readonly getEnglish: () => HTMLElement | null;
  readonly hasValidSelection: () => boolean;
  readonly restore: () => void;
}

export class YouTubeCaptionSelectionGesture {
  readonly #acceptsUserGesture: (event: Event) => boolean;
  readonly #canCommit: () => boolean;
  readonly #commit: () => void;
  readonly #documentRef: Document;
  readonly #getEnglish: () => HTMLElement | null;
  readonly #hasValidSelection: () => boolean;
  readonly #restore: () => void;
  #active = false;
  #changed = false;
  #pendingFinish = false;
  #pointerId: number | null = null;
  #revision = 0;

  constructor(options: YouTubeCaptionSelectionGestureOptions) {
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
    this.#documentRef.addEventListener("pointerdown", this.handlePointerDown, true);
    this.#documentRef.addEventListener("pointercancel", this.handlePointerCancel, true);
    this.#documentRef.addEventListener("mouseup", this.handleMouseup, true);
    this.#documentRef.addEventListener("selectionchange", this.handleSelectionChange);
    this.#documentRef.defaultView?.addEventListener("pointerup", this.handlePointerUp, true);
  }

  stop(): void {
    this.#documentRef.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.#documentRef.removeEventListener("pointercancel", this.handlePointerCancel, true);
    this.#documentRef.removeEventListener("mouseup", this.handleMouseup, true);
    this.#documentRef.removeEventListener("selectionchange", this.handleSelectionChange);
    this.#documentRef.defaultView?.removeEventListener("pointerup", this.handlePointerUp, true);
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
