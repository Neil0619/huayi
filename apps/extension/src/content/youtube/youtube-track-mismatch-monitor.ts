export class YouTubeTrackMismatchMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly isMismatch: () => boolean,
    private readonly onConfirmed: () => void,
    private readonly delayMs = 2_000,
  ) {}

  observeMismatch(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.isMismatch()) this.onConfirmed();
    }, this.delayMs);
  }

  clear(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
