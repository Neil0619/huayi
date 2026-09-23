import type { StoreKeyboardShortcut } from "@huayi/store-domain";
import type { StoreOverlayController } from "../overlay/store-overlay-controller.js";
import { CaptionSelectionGesture } from "../subtitles/caption-selection-gesture.js";
import { TemporaryTranslationHold } from "../subtitles/temporary-translation-hold.js";
import { SubtitleShortcutController } from "../subtitles/subtitle-shortcut.js";
import { MediaPauseOwnership } from "../subtitles/media-pause-ownership.js";
import type { LocalSentence } from "../subtitles/local-subtitles.js";
import type { MediaSession } from "./asbplayer-media-session.js";
import type { AsbplayerPresentation } from "./asbplayer-presentation.js";
import { readAsbplayerSelection } from "./asbplayer-selection.js";
interface Options {
  readonly document: Document;
  readonly media: MediaSession;
  readonly overlay: StoreOverlayController;
  readonly getView: () => AsbplayerPresentation | null;
  readonly getSentences: () => readonly LocalSentence[];
  readonly getModes: () => readonly number[] | null;
  readonly isUsable: () => boolean;
  readonly refresh: () => void;
  readonly shortcut: StoreKeyboardShortcut | null;
  readonly acceptsUserGesture: (event: Event) => boolean;
}
export class AsbplayerInteraction {
  private readonly pause: MediaPauseOwnership;
  private readonly gesture: CaptionSelectionGesture;
  private readonly hold: TemporaryTranslationHold;
  private shortcut: SubtitleShortcutController;
  private selection = false;
  private generation = 0;
  private pendingTarget: EventTarget | null = null;
  constructor(private readonly options: Options) {
    this.pause = new MediaPauseOwnership(() => options.media, options.getModes);
    this.hold = new TemporaryTranslationHold((holding) => {
      options.getView()?.setHolding(holding);
      if (holding) this.pause.acquire("hold");
      else this.pause.release("hold");
    });
    this.shortcut = new SubtitleShortcutController(options.document, {
      canHold: () => this.usable() && (options.getView()?.canShowChinese() ?? false),
      setHolding: (holding) => this.hold.set("keyboard", holding),
      shortcut: options.shortcut,
    });
    this.gesture = new CaptionSelectionGesture({
      document: options.document,
      acceptsUserGesture: options.acceptsUserGesture,
      canCommit: () => !this.selection && this.usable(),
      getEnglish: () => (this.usable() ? (options.getView()?.getEnglish() ?? null) : null),
      hasValidSelection: () => this.read() !== null,
      commit: () => this.commit(),
      restore: options.refresh,
    });
  }
  get frozen(): boolean {
    return this.selection || this.gesture.active;
  }
  start(): void {
    this.listen("addEventListener");
    this.gesture.start();
    this.pause.bind();
  }
  stop(): void {
    this.listen("removeEventListener");
    this.gesture.stop();
    this.reset();
    this.pause.destroy();
  }
  reset(): void {
    this.generation += 1;
    this.pause.revoke();
    this.shortcut.clear();
    this.hold.clear();
    this.selection = false;
    this.gesture.clear();
    this.pendingTarget = null;
    this.options.overlay.close("owner-clear");
    this.pause.bind();
  }
  modesChanged(): void {
    this.pause.revoke();
  }
  setShortcut(shortcut: StoreKeyboardShortcut | null): void {
    this.options.isUsable();
    this.shortcut.clear();
    this.shortcut = new SubtitleShortcutController(this.options.document, {
      canHold: () => this.usable() && (this.options.getView()?.canShowChinese() ?? false),
      setHolding: (value) => this.hold.set("keyboard", value),
      shortcut,
    });
  }
  holdPointer(value: boolean): void {
    const usable = this.usable();
    if (value && (!usable || !this.options.getView()?.canShowChinese())) return;
    this.hold.set("pointer", value);
  }
  relocate(): void {
    if (this.selection) this.options.overlay.relocate(this.options.getView()?.getMount() ?? null);
  }
  private read() {
    if (!this.usable()) return null;
    return readAsbplayerSelection(
      this.options.document,
      this.options.getView()?.getEnglish() ?? null,
      this.options.getSentences(),
    );
  }
  private usable(): boolean {
    return this.options.isUsable() && (this.options.getView()?.isUsable() ?? false);
  }
  private commit(): void {
    const selected = this.read();
    if (!selected) {
      this.options.refresh();
      return;
    }
    this.pause.acquire("selection"); // Transfer the owned hold before clearing its last source.
    this.hold.clear();
    this.selection = true;
    const generation = this.generation;
    const bounds = selected.range.getBoundingClientRect();
    this.options.overlay.show(
      selected.reading,
      { top: bounds.top, bottom: bounds.bottom, left: (bounds.left + bounds.right) / 2 },
      () => {
        this.options.isUsable();
        if (generation !== this.generation) return;
        this.selection = false;
        this.pause.release("selection");
        this.options.refresh();
      },
      {
        mount: this.options.getView()?.getMount() ?? null,
        ignoreOutsidePointer: (event) => this.isPlayerControl(event.target),
      },
    );
  }
  private listen(method: "addEventListener" | "removeEventListener"): void {
    const doc = this.options.document;
    const listen: Document["addEventListener"] = doc[method].bind(doc);
    listen("pointerdown", this.pointerDown, true);
    listen("click", this.click, true);
    listen("keydown", this.keyDown, true);
    listen("keyup", this.keyUp, true);
    listen("visibilitychange", this.visibility);
    doc.defaultView?.[method]("blur", this.blur);
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    this.options.isUsable();
    this.pendingTarget = null;
    if (!this.options.acceptsUserGesture(event)) return;
    const view = this.options.getView(),
      player = this.options.media.video?.parentElement;
    if (
      event.composedPath().includes(view?.host as EventTarget) ||
      event
        .composedPath()
        .some((item) => item instanceof Element && item.hasAttribute("data-huayi-store-overlay"))
    )
      return;
    const target = event.target;
    if (
      this.selection &&
      target instanceof Element &&
      player?.contains(target) &&
      !target.closest(
        "button,input,select,[role=button],[role=slider],.MuiSlider-root,[contenteditable]",
      )
    ) {
      this.pendingTarget = target;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.options.overlay.close();
      return;
    }
    if (!(this.isPlayerControl(target) && this.isFullscreenControl(target))) this.pause.revoke();
  };
  private isPlayerControl(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      (this.options.media.video?.parentElement?.contains(target) ?? false) &&
      target.closest(
        "button,input,select,[role=button],[role=slider],.MuiSlider-root,[contenteditable]",
      ) !== null
    );
  }
  private isFullscreenControl(target: EventTarget | null): boolean {
    const button = target instanceof Element ? target.closest("button,[role=button]") : null;
    if (!button) return false;
    return (
      /full.?screen|全屏/iu.test(
        [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.id,
          button.textContent?.slice(0, 128),
        ].join(" "),
      ) ||
      button.querySelector('[data-testid="FullscreenIcon"],[data-testid="FullscreenExitIcon"]') !==
        null
    );
  }
  private readonly click = (event: MouseEvent): void => {
    const target = this.pendingTarget;
    this.pendingTarget = null;
    if (target !== null && event.target === target) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private readonly keyDown = (event: KeyboardEvent): void => {
    this.options.isUsable();
    this.shortcut.handleKeydown(event);
    if (event.defaultPrevented || event.key === "Escape") return;
    const own = this.options.getView()?.host;
    if (
      event.composedPath().includes(own as EventTarget) ||
      event
        .composedPath()
        .some((item) => item instanceof Element && item.hasAttribute("data-huayi-store-overlay"))
    )
      return;
    if ([" ", "k", "K", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
      this.pause.revoke();
  };
  private readonly blur = (): void => {
    this.options.isUsable();
    this.shortcut.clear();
    this.hold.clear();
    if (!this.selection) this.gesture.clear();
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    this.options.isUsable();
    this.shortcut.handleKeyup(event);
  };
  private readonly visibility = (): void => {
    if (this.options.document.visibilityState === "hidden") this.blur();
  };
}
