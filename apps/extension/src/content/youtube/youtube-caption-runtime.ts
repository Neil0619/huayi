export interface YouTubeCaptionRuntimeHandlers {
  blur: () => void;
  click: (event: MouseEvent) => void;
  fullscreenchange: () => void;
  keydown: (event: KeyboardEvent) => void;
  keyup: (event: KeyboardEvent) => void;
  mouseup: (event: MouseEvent) => void;
  navigation: (event: Event) => void;
  pointerdown: (event: PointerEvent) => void;
  selectionchange: () => void;
  visibilitychange: () => void;
  playback: () => void;
  timeupdate: () => void;
}

export class YouTubeCaptionRuntime {
  private readonly documentRef: Document;
  private readonly handlers: YouTubeCaptionRuntimeHandlers;
  private video: HTMLVideoElement | null = null;

  constructor(documentRef: Document, handlers: YouTubeCaptionRuntimeHandlers) {
    this.documentRef = documentRef;
    this.handlers = handlers;
    documentRef.addEventListener("fullscreenchange", handlers.fullscreenchange);
    documentRef.defaultView?.addEventListener("keydown", handlers.keydown, true);
    documentRef.defaultView?.addEventListener("keyup", handlers.keyup, true);
    documentRef.addEventListener("click", handlers.click, true);
    documentRef.addEventListener("pointerdown", handlers.pointerdown, true);
    documentRef.addEventListener("selectionchange", handlers.selectionchange);
    documentRef.addEventListener("mouseup", handlers.mouseup);
    documentRef.addEventListener("visibilitychange", handlers.visibilitychange);
    documentRef.addEventListener("yt-navigate-finish", handlers.navigation);
    documentRef.addEventListener("yt-navigate-start", handlers.navigation);
    documentRef.addEventListener("yt-page-data-updated", handlers.navigation);
    documentRef.defaultView?.addEventListener("blur", handlers.blur);
  }

  attachVideo(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.detachVideo();
    this.video = video;
    video.addEventListener("ended", this.handlers.playback);
    video.addEventListener("play", this.handlers.playback);
    video.addEventListener("seeking", this.handlers.playback);
    video.addEventListener("timeupdate", this.handlers.timeupdate);
  }

  detachVideo(): void {
    this.video?.removeEventListener("ended", this.handlers.playback);
    this.video?.removeEventListener("play", this.handlers.playback);
    this.video?.removeEventListener("seeking", this.handlers.playback);
    this.video?.removeEventListener("timeupdate", this.handlers.timeupdate);
    this.video = null;
  }

  destroy(): void {
    this.detachVideo();
    const handlers = this.handlers;
    this.documentRef.removeEventListener("fullscreenchange", handlers.fullscreenchange);
    this.documentRef.defaultView?.removeEventListener("keydown", handlers.keydown, true);
    this.documentRef.defaultView?.removeEventListener("keyup", handlers.keyup, true);
    this.documentRef.removeEventListener("click", handlers.click, true);
    this.documentRef.removeEventListener("pointerdown", handlers.pointerdown, true);
    this.documentRef.removeEventListener("selectionchange", handlers.selectionchange);
    this.documentRef.removeEventListener("mouseup", handlers.mouseup);
    this.documentRef.removeEventListener("visibilitychange", handlers.visibilitychange);
    this.documentRef.removeEventListener("yt-navigate-finish", handlers.navigation);
    this.documentRef.removeEventListener("yt-navigate-start", handlers.navigation);
    this.documentRef.removeEventListener("yt-page-data-updated", handlers.navigation);
    this.documentRef.defaultView?.removeEventListener("blur", handlers.blur);
  }
}
