export type TemporaryTranslationHoldSource = "keyboard" | "pointer";

/** Collapses independent press lifetimes into one display decision. */
export class TemporaryTranslationHold {
  private readonly activeSources = new Set<TemporaryTranslationHoldSource>();

  constructor(private readonly onChange: (held: boolean) => void) {}

  set(source: TemporaryTranslationHoldSource, held: boolean): void {
    const wasHeld = this.isHeld;
    if (held) this.activeSources.add(source);
    else this.activeSources.delete(source);
    if (wasHeld !== this.isHeld) this.onChange(this.isHeld);
  }

  clear(): void {
    if (!this.isHeld) return;
    this.activeSources.clear();
    this.onChange(false);
  }

  get isHeld(): boolean {
    return this.activeSources.size > 0;
  }
}
