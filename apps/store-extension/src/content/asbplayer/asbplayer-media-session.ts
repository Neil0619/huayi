import {
  readAsbplayerPlaybackContext,
  sameAsbplayerContext,
  type AsbplayerPlaybackContext,
} from "./asbplayer-location.js";
import { selectAsbplayerVideo } from "./asbplayer-video.js";
export interface MediaSession {
  readonly generation: number;
  readonly snapshotGeneration?: number;
  readonly video: HTMLVideoElement | null;
  refresh(): boolean;
  clear(): void;
}
export class AsbplayerMediaSession implements MediaSession {
  generation = 0;
  snapshotGeneration = 0;
  video: HTMLVideoElement | null = null;
  private context: AsbplayerPlaybackContext | null = null;
  private boundVideo: HTMLVideoElement | null = null;
  constructor(
    private readonly doc: Document,
    private readonly readContext = () =>
      doc.defaultView ? readAsbplayerPlaybackContext(doc.defaultView) : null,
  ) {}
  refresh(): boolean {
    const context = this.readContext();
    const video = context ? selectAsbplayerVideo(this.doc, context.mediaUrl) : null;
    const contextChanged = !sameAsbplayerContext(context, this.context);
    const mediaChanged =
      this.boundVideo !== null &&
      (!this.boundVideo.isConnected ||
        this.boundVideo.getAttribute("src") !== context?.mediaUrl ||
        (video !== null && video !== this.boundVideo));
    if (contextChanged || mediaChanged) {
      this.snapshotGeneration += 1;
      this.boundVideo = null;
    }
    // First discovery and temporary visibility/layout changes do not change subtitle identity.
    if (video) this.boundVideo = video;
    if (!contextChanged && !mediaChanged && video === this.video) return false;
    this.context = context;
    this.video = video;
    this.generation += 1;
    return true;
  }
  clear(): void {
    this.context = null;
    this.video = null;
    this.boundVideo = null;
    this.generation += 1;
    this.snapshotGeneration += 1;
  }
}
