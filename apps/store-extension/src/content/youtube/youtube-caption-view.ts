import type { SubtitleSentence } from "./youtube-subtitles.js";

const PLAYER_GESTURE_EVENTS = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "click",
  "dblclick",
] as const;

const YOUTUBE_CAPTION_STYLES = `[data-huayi-store-youtube-active] :is(.ytp-caption-window-container,.ytp-caption-segment){visibility:hidden!important}#huayi-y{position:absolute;z-index:59;left:50%;bottom:max(64px,9%);display:flex;max-width:min(90%,1100px);padding:4px 10px;flex-direction:column;align-items:center;transform:translateX(-50%);border-radius:6px;color:#fff;background:#080808b8;font:500 clamp(18px,2.2vw,30px)/1.32 Roboto,Arial,sans-serif;text-align:center;text-shadow:0 1px 2px #000,0 0 4px #000;pointer-events:auto}#huayi-y>:first-child{cursor:text;user-select:text}#huayi-y>:nth-child(2){margin-top:2px;font-size:.9em;font-weight:450;user-select:none}#huayi-y>button{position:absolute;top:-9px;right:-9px;width:24px;height:24px;padding:0;border:1px solid #ffffff57;border-radius:50%;color:#fffffff0;background:#121212d1;font:650 12px/1 system-ui,sans-serif;cursor:pointer;opacity:.88}#huayi-y>button:is(:hover,[aria-pressed=true]){border-color:#67e8f9;color:#67e8f9;opacity:1}#huayi-yc{display:inline-flex;float:left;width:48px;height:100%;align-items:center;justify-content:center}#huayi-yc>button{width:48px;height:100%;min-height:36px;padding:0;border:0;color:#fff;background:transparent;font:700 16px/1 system-ui,sans-serif;text-shadow:0 1px 2px #000c;cursor:pointer;opacity:.92}#huayi-yc>button[aria-pressed=true]{color:#67e8f9}:is(#huayi-y>button,#huayi-yc>button):disabled{cursor:default;opacity:.38}:is(#huayi-y>button,#huayi-yc>button):focus-visible{outline:2px solid #67e8f9;outline-offset:-4px}`;

function containPlayerGestures(button: HTMLButtonElement): void {
  for (const type of PLAYER_GESTURE_EVENTS) {
    button.addEventListener(type, (event) => event.stopPropagation());
  }
}

export class YouTubeCaptionView {
  readonly english: HTMLElement;
  readonly #controlHost: HTMLElement;
  readonly #fixedButton: HTMLButtonElement;
  readonly #host: HTMLElement;
  readonly #onTemporaryHold: (holding: boolean) => void;
  readonly #player: HTMLElement;
  readonly #shortcutLabel: string;
  readonly #style: HTMLStyleElement;
  readonly #temporaryButton: HTMLButtonElement;
  readonly #translated: HTMLElement;
  #holding = false;
  #pinned: boolean;
  #translatedReady = false;

  constructor(
    documentRef: Document,
    player: HTMLElement,
    defaultBilingual: boolean,
    onToggle: () => void,
    onTemporaryHold: (holding: boolean) => void = () => undefined,
    shortcutLabel = "",
  ) {
    this.#player = player;
    this.#pinned = defaultBilingual;
    this.#onTemporaryHold = onTemporaryHold;
    this.#shortcutLabel = shortcutLabel;
    this.#style = documentRef.createElement("style");
    this.#style.textContent = YOUTUBE_CAPTION_STYLES;
    this.#host = documentRef.createElement("section");
    this.#host.id = "huayi-y";
    this.#host.dataset.huayiStoreYoutubeSubtitles = "";
    this.#host.setAttribute("aria-live", "off");
    this.english = documentRef.createElement("div");
    this.english.dataset.huayiStoreYoutubeEnglish = "";
    this.#translated = documentRef.createElement("div");
    this.#translated.dataset.huayiStoreYoutubeTranslated = "";
    this.#temporaryButton = this.#createTemporaryButton(documentRef);
    this.#host.append(this.english, this.#translated, this.#temporaryButton);

    this.#controlHost = documentRef.createElement("div");
    this.#controlHost.id = "huayi-yc";
    this.#controlHost.dataset.huayiStoreYoutubeControlHost = "";
    this.#fixedButton = documentRef.createElement("button");
    this.#fixedButton.dataset.huayiStoreYoutubeBilingual = "";
    this.#fixedButton.type = "button";
    this.#fixedButton.textContent = "中";
    this.#fixedButton.setAttribute("aria-label", "固定显示中文字幕");
    containPlayerGestures(this.#fixedButton);
    this.#fixedButton.addEventListener("click", onToggle);
    this.#controlHost.append(this.#fixedButton);

    player.append(this.#style, this.#host);
    this.mountControl(player);
    player.dataset.huayiStoreYoutubeActive = "";
    this.#updateControls(false);
  }

  render(
    sentence: SubtitleSentence | null,
    translatedText: string | null,
    translatedReady: boolean,
  ): void {
    this.#translatedReady = translatedReady;
    this.#updateControls(translatedReady);
    if (sentence === null) {
      this.#host.hidden = true;
      return;
    }
    if (this.english.textContent !== sentence.text) this.english.textContent = sentence.text;
    if (this.#translated.textContent !== (translatedText ?? "")) {
      this.#translated.textContent = translatedText ?? "";
    }
    this.#translated.hidden = !((this.#pinned || this.#holding) && translatedText !== null);
    this.#host.hidden = false;
  }

  mountControl(player: HTMLElement): boolean {
    const subtitlesButton = player.querySelector<HTMLElement>(".ytp-subtitles-button");
    if (subtitlesButton?.parentElement === null || subtitlesButton === null) return false;
    if (this.#controlHost.nextElementSibling !== subtitlesButton) {
      subtitlesButton.before(this.#controlHost);
    }
    return true;
  }

  toggleBilingual(): void {
    if (this.#fixedButton.disabled) return;
    this.#pinned = !this.#pinned;
    this.#updateControls(true);
  }

  canShowTranslation(): boolean {
    return this.#translatedReady;
  }

  setTemporaryBilingual(holding: boolean): void {
    this.#holding = holding && this.#translatedReady;
    const pressed = String(this.#holding);
    if (this.#temporaryButton.getAttribute("aria-pressed") !== pressed) {
      this.#temporaryButton.setAttribute("aria-pressed", pressed);
    }
  }

  destroy(): void {
    delete this.#player.dataset.huayiStoreYoutubeActive;
    this.#controlHost.remove();
    this.#host.remove();
    this.#style.remove();
  }

  #createTemporaryButton(documentRef: Document): HTMLButtonElement {
    const button = documentRef.createElement("button");
    button.dataset.huayiStoreYoutubeTemporaryTranslation = "";
    button.type = "button";
    button.textContent = "中";
    const title =
      this.#shortcutLabel.length > 0 ? `按住显示中文（${this.#shortcutLabel}）` : "按住显示中文";
    button.title = title;
    button.setAttribute("aria-label", title.replace("中文", "中文字幕"));
    button.setAttribute("aria-pressed", "false");
    containPlayerGestures(button);
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled) return;
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      this.#setPointerHolding(true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      button.addEventListener(type, () => this.#setPointerHolding(false));
    }
    button.addEventListener("blur", () => this.#setPointerHolding(false));
    button.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
        event.preventDefault();
        this.#setPointerHolding(true);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.#setPointerHolding(false);
      }
    });
    return button;
  }

  #setPointerHolding(holding: boolean): void {
    const next = holding && !this.#temporaryButton.disabled;
    const pressed = String(next);
    if (this.#temporaryButton.getAttribute("aria-pressed") !== pressed) {
      this.#temporaryButton.setAttribute("aria-pressed", pressed);
    }
    this.#onTemporaryHold(next);
  }

  #updateControls(ready: boolean): void {
    this.#fixedButton.disabled = !ready;
    this.#temporaryButton.disabled = !ready;
    const pressed = String(ready && this.#pinned);
    if (this.#fixedButton.getAttribute("aria-pressed") !== pressed) {
      this.#fixedButton.setAttribute("aria-pressed", pressed);
    }
    this.#fixedButton.title = ready
      ? this.#shortcutLabel.length > 0
        ? `固定显示中文字幕（按住 ${this.#shortcutLabel} 临时显示）`
        : "固定显示中文字幕"
      : "中文字幕尚未就绪";
    if (!ready) this.#setPointerHolding(false);
  }
}
