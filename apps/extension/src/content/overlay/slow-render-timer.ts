export class SlowRenderTimer {
  private readonly onElapsed: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(onElapsed: () => void) {
    this.onElapsed = onElapsed;
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  schedule(): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onElapsed();
    }, 8_000);
  }
}
