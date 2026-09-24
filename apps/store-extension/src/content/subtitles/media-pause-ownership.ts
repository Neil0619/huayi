interface MediaIdentity {
  readonly video: HTMLVideoElement | null;
  readonly generation: number;
}
type Owner = "hold" | "selection";
/** Ownership is scoped to a media generation and revoked by user or upstream intervention. */
export class MediaPauseOwnership {
  private video: HTMLVideoElement | null = null;
  private owned: MediaIdentity | null = null;
  private readonly owners = new Set<Owner>();
  private expectedPause = false;
  constructor(
    private readonly current: () => MediaIdentity,
    private readonly modes: () => readonly number[] | null,
  ) {}
  bind(): void {
    const video = this.current().video;
    if (video === this.video) return;
    this.destroy();
    this.video = video;
    for (const type of ["play", "pause", "seeking", "emptied"])
      video?.addEventListener(type, this.onMedia);
  }
  acquire(owner: Owner): void {
    this.bind();
    if (this.owned && this.valid()) {
      this.owners.add(owner);
      return;
    }
    const identity = this.current(),
      video = identity.video;
    if (!video || video.paused || video.ended) return;
    this.owned = { ...identity };
    this.owners.add(owner);
    this.expectedPause = true;
    try {
      video.pause();
    } catch {
      this.revoke();
    }
  }
  release(owner: Owner): void {
    this.owners.delete(owner);
    if (this.owners.size) return;
    const identity = this.owned;
    const modes = this.modes();
    const resume = this.valid() && modes?.length === 1 && modes[0] === 1;
    this.revoke();
    if (!resume || !identity?.video?.paused || identity.video.ended) return;
    try {
      void identity.video.play().catch(() => undefined);
    } catch {
      /* Browser policy failure stays paused. */
    }
  }
  revoke(): void {
    this.owned = null;
    this.owners.clear();
    this.expectedPause = false;
  }
  destroy(): void {
    this.revoke();
    for (const type of ["play", "pause", "seeking", "emptied"])
      this.video?.removeEventListener(type, this.onMedia);
    this.video = null;
  }
  private valid(): boolean {
    const current = this.current();
    return (
      this.owned !== null &&
      current.video === this.owned.video &&
      current.generation === this.owned.generation
    );
  }
  private readonly onMedia = (event: Event): void => {
    // play() queues its event before our pause(). While that pause is pending,
    // a play event on an already paused video does not describe new playback.
    if (event.type === "play" && this.expectedPause && this.valid() && this.video?.paused) return;
    if (event.type === "pause" && this.expectedPause && this.valid()) {
      this.expectedPause = false;
      return;
    }
    this.revoke();
  };
}
