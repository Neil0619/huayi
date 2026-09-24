import { onlyAsbplayerOffsetChanged, asbplayerFallbackMessage } from "./asbplayer-readiness.js";
import { AsbplayerInteraction } from "./asbplayer-interaction.js";
import type {
  AsbplayerMode,
  StoreAppearance,
  StoreKeyboardShortcut,
  StoreAsbplayerSettingsResponse,
} from "@huayi/store-domain";
import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import {
  createSubtitleIndex,
  segmentLocalCues,
  type LocalCue,
  type LocalSentence,
} from "../subtitles/local-subtitles.js";
import type { SubtitleSnapshot } from "./asbplayer-bridge-client.js";
import { AsbplayerMediaSession, type MediaSession } from "./asbplayer-media-session.js";
import { AsbplayerPresentation } from "./asbplayer-presentation.js";
import type { AsbplayerSnapshot } from "./asbplayer-snapshot.js";
import { prepareAsbplayerTracks } from "./asbplayer-tracks.js";
export interface AsbplayerControllerOptions {
  readonly document: Document;
  readonly bridge: SubtitleSnapshot;
  readonly mode: Exclude<AsbplayerMode, "disabled">;
  readonly appearance: StoreAppearance;
  readonly shortcut?: StoreKeyboardShortcut | null;
  readonly overlay: StoreOverlayController;
  readonly media?: MediaSession;
  readonly acceptsUserGesture?: (event: Event) => boolean;
}
export class AsbplayerController {
  private readonly media: MediaSession;
  private readonly interaction: AsbplayerInteraction;
  private view: AsbplayerPresentation | null = null;
  private snapshot: AsbplayerSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: number | null = null;
  private confirmed = false;
  private selectedTracks: readonly [number, number | null] | null = null;
  private sentences: readonly LocalSentence[] = [];
  private englishIndex = createSubtitleIndex<LocalSentence>([]);
  private chineseIndex = createSubtitleIndex<LocalSentence>([]);
  private nativeIndex = createSubtitleIndex<LocalCue>([]);
  private chineseReady = false;
  private started = false;
  private usable = false;
  private mediaGeneration: number | null = null;
  private retiredSession = 0;
  private lastSession = 0;
  private message = "请选择英语和中文轨道；也可以不选择中文。";
  constructor(private readonly options: AsbplayerControllerOptions) {
    this.media = options.media ?? new AsbplayerMediaSession(options.document);
    this.interaction = new AsbplayerInteraction({
      document: options.document,
      media: this.media,
      overlay: options.overlay,
      getView: () => this.view,
      getSentences: () => this.sentences,
      getModes: () => this.snapshot?.playModes ?? null,
      isUsable: () => {
        if (!this.started) return false;
        this.synchronizeMedia();
        if (
          !this.media.video ||
          this.options.document.fullscreenElement instanceof HTMLVideoElement
        ) {
          this.refresh();
          return false;
        }
        return this.usable;
      },
      refresh: this.refresh,
      shortcut: options.shortcut ?? null,
      acceptsUserGesture: options.acceptsUserGesture ?? ((event) => event.isTrusted),
    });
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.view = new AsbplayerPresentation(this.options.document, {
      bilingual: this.options.mode === "bilingual",
      appearance: this.options.appearance,
      confirm: (en, zh) => this.confirm(en, zh),
      reset: () => this.reset(),
      hold: (value) => this.interaction.holdPointer(value),
    });
    this.media.refresh();
    this.mediaGeneration = this.media.snapshotGeneration ?? this.media.generation;
    this.interaction.start();
    this.unsubscribe = this.options.bridge.subscribe((snapshot) => {
      if (!this.started) return;
      this.synchronizeMedia();
      if (snapshot.session < this.retiredSession) return;
      this.view?.setBridgeReady();
      this.lastSession = snapshot.session;
      const previous = this.snapshot;
      this.snapshot = snapshot;
      if (previous && JSON.stringify(previous.playModes) !== JSON.stringify(snapshot.playModes))
        this.interaction.modesChanged();
      if (this.confirmed && this.selectedTracks && onlyAsbplayerOffsetChanged(previous, snapshot)) {
        this.interaction.reset();
        this.confirm(...this.selectedTracks);
      } else if (
        !previous ||
        snapshot.cues !== previous.cues ||
        snapshot.session !== previous.session ||
        snapshot.status !== "ready"
      )
        this.reset();
      this.refresh();
    });
    this.options.bridge.start();
    this.options.document.addEventListener("fullscreenchange", this.refresh);
    this.options.document.defaultView?.addEventListener("pagehide", this.pageHide);
    this.timer = this.options.document.defaultView?.setInterval(this.refresh, 100) ?? null;
    this.refresh();
  }
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) this.options.document.defaultView?.clearInterval(this.timer);
    this.options.document.removeEventListener("fullscreenchange", this.refresh);
    this.options.document.defaultView?.removeEventListener("pagehide", this.pageHide);
    this.reset();
    this.interaction.stop();
    this.snapshot = null;
    this.mediaGeneration = null;
    this.retiredSession = 0;
    this.lastSession = 0;
    this.media.clear();
    this.view?.destroy();
    this.view = null;
    this.usable = false;
    this.options.bridge.destroy();
  }
  private readonly pageHide = (): void => this.stop();
  private setStatus(...args: Parameters<AsbplayerPresentation["setStatus"]>): void {
    const usable = args[0] === "usable";
    const wasUsable = this.usable;
    this.usable = usable;
    if (!usable && wasUsable) this.interaction.reset();
    this.view?.setStatus(...args);
  }
  setAppearance(appearance: StoreAppearance): void {
    this.view?.setAppearance(appearance);
  }
  updatePreferences(settings: StoreAsbplayerSettingsResponse): void {
    this.view?.setBilingual(settings.asbplayerMode === "bilingual");
    this.interaction.setShortcut(settings.asbplayerShortcut);
    this.setAppearance(settings.appearance);
  }
  private reset(): void {
    this.confirmed = false;
    this.selectedTracks = null;
    this.message = "请选择英语和中文轨道；也可以不选择中文。";
    this.sentences = [];
    this.englishIndex = createSubtitleIndex([]);
    this.chineseIndex = createSubtitleIndex([]);
    this.nativeIndex = createSubtitleIndex([]);
    this.chineseReady = false;
    this.view?.restoreNative();
    this.interaction.reset();
    this.refresh();
  }
  private confirm(english: number, chinese: number | null): void {
    this.refresh();
    if (
      !this.snapshot ||
      this.snapshot.status !== "ready" ||
      !this.snapshot.offsetKnown ||
      !this.media.video
    )
      return;
    const tracks = prepareAsbplayerTracks(this.snapshot.cues, english, chinese);
    if (!tracks) {
      this.message =
        "无法确认英语字幕。双语字幕需为独立的英文行和中文行；请拆分为两条轨道后重新加载。";
      this.refresh();
      return;
    }
    this.sentences = segmentLocalCues(tracks.english);
    if (!this.sentences.length) {
      this.message =
        "字幕时间范围或分段超出支持范围，已保留原字幕。请检查字幕时间，拆分文件后重新加载。";
      this.confirmed = false;
      this.refresh();
      return;
    }
    this.englishIndex = createSubtitleIndex(this.sentences);
    this.chineseIndex = createSubtitleIndex(
      tracks.chinese.map((cue, id) => ({ ...cue, id, complete: false })),
    );
    this.nativeIndex = createSubtitleIndex(tracks.native);
    this.chineseReady = tracks.chinese.length > 0;
    this.confirmed = true;
    this.selectedTracks = [english, chinese];
    this.refresh();
  }
  private synchronizeMedia(): void {
    const changed = this.media.refresh();
    const generation = this.media.snapshotGeneration ?? this.media.generation;
    if (this.mediaGeneration !== null && generation !== this.mediaGeneration) {
      this.mediaGeneration = generation;
      if (this.lastSession) this.retiredSession = this.lastSession + 1;
      this.snapshot = null;
      this.reset();
    } else if (changed) this.interaction.reset();
    this.mediaGeneration = generation;
    this.options.bridge.refreshContext?.();
  }
  private readonly refresh = (): void => {
    if (!this.started || !this.view) return;
    this.synchronizeMedia();
    const mounted = this.view.mount(this.media.video);
    this.interaction.relocate();
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      snapshot.status === "waiting" ||
      (snapshot.status === "ready" && !snapshot.offsetKnown)
    ) {
      this.setStatus(
        "waiting-full-snapshot",
        "等待完整字幕和时间偏移。若一直未就绪，请重新加载 asbplayer 播放器。",
      );
      return;
    }
    if (snapshot.status === "invalidated" || !mounted) {
      this.setStatus(
        "invalidated",
        asbplayerFallbackMessage(
          snapshot,
          this.options.document.fullscreenElement instanceof HTMLVideoElement,
        ),
      );
      return;
    }
    if (!snapshot.cues.some((cue) => cue.text.trim())) {
      this.setStatus(
        "waiting-full-snapshot",
        "未读取到字幕文本。请加载外挂文本字幕；若已加载，请将字幕副本放到较短路径后重试，并检查文件编码。",
      );
      return;
    }
    if (!this.confirmed) {
      this.setStatus("waiting-tracks", this.message, snapshot.cues);
      return;
    }
    if (this.interaction.frozen) {
      this.setStatus("usable", "");
      return;
    }
    const video = this.media.video;
    const timestampMs = (video?.currentTime ?? 0) * 1000;
    if (!video?.ended && this.nativeIndex.at(timestampMs).length) {
      this.setStatus("native-subtitles", "此段没有可确定的独立英文行，暂时显示原字幕。");
      return;
    }
    const active = video?.ended ? [] : this.englishIndex.at(timestampMs);
    const crowded = () =>
      this.setStatus("invalidated", "同一时段字幕过多，暂时保留原字幕。请整理重叠轨道后重新加载。");
    if (active.length > 64) {
      crowded();
      return;
    }
    active.sort((a, b) => a.id - b.id);
    const chinese = new Map<number, LocalSentence>();
    for (const sentence of active)
      for (const cue of this.chineseIndex.overlapping(sentence.startMs, sentence.endMs)) {
        chinese.set(cue.id, cue);
        if (chinese.size > 256) {
          crowded();
          return;
        }
      }
    this.setStatus("usable", "");
    const text = [...chinese.values()]
      .sort((a, b) => a.startMs - b.startMs || a.id - b.id)
      .map((cue) => cue.text)
      .join(" ");
    this.view.render(active, text || null, this.chineseReady);
  };
}
