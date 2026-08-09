import type { YouTubeCaptionBridge } from "./youtube-caption-bridge-client.js";

interface ReconcileSourceTrackOptions {
  expectedVideoId: string;
  generation: number;
  hasMismatch: () => boolean;
  isCurrent: () => boolean;
  onDifferentEnglish: () => void;
  onSameSource: () => void;
  onSuspended: () => void;
}

export class YouTubeSourceTrackReconciler {
  private pending = false;
  private suspended = false;

  constructor(private readonly bridge: YouTubeCaptionBridge) {}

  get isPending(): boolean {
    return this.pending;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  reset(): void {
    this.pending = false;
    this.suspended = false;
  }

  resume(): void {
    this.suspended = false;
  }

  async reconcile(options: ReconcileSourceTrackOptions): Promise<void> {
    if (this.pending || !options.hasMismatch()) return;
    this.pending = true;
    try {
      const status = await this.bridge.probeSource({
        expectedVideoId: options.expectedVideoId,
        generation: options.generation,
      });
      if (!options.isCurrent()) return;
      if (status === "same-source") {
        this.suspended = false;
        options.onSameSource();
      } else if (status === "different-english") {
        this.suspended = false;
        options.onDifferentEnglish();
      } else if (options.hasMismatch()) {
        this.suspended = true;
        options.onSuspended();
      }
    } finally {
      this.pending = false;
    }
  }
}
