export type TemporaryTranslationSource = "keyboard" | "pointer";

/** Combines independent press lifetimes into one temporary translation display state. */
export class YouTubeTemporaryTranslationHold {
  readonly #activeSources = new Set<TemporaryTranslationSource>();
  readonly #onChange: (holding: boolean) => void;

  constructor(onChange: (holding: boolean) => void) {
    this.#onChange = onChange;
  }

  set(source: TemporaryTranslationSource, holding: boolean): void {
    const wasHolding = this.#isHolding;
    if (holding) this.#activeSources.add(source);
    else this.#activeSources.delete(source);
    if (wasHolding !== this.#isHolding) this.#onChange(this.#isHolding);
  }

  clear(): void {
    if (!this.#isHolding) return;
    this.#activeSources.clear();
    this.#onChange(false);
  }

  get #isHolding(): boolean {
    return this.#activeSources.size > 0;
  }
}
