import type { StoreAppearance } from "@huayi/store-domain";
import { setSubtitleAppearance } from "../subtitles/subtitle-appearance.js";
import type { LocalSentence } from "../subtitles/local-subtitles.js";
import type { AsbplayerCue } from "./asbplayer-snapshot.js";
import { describeAsbplayerTracks } from "./asbplayer-tracks.js";
export type LearningStatus = "waiting-full-snapshot" | "waiting-tracks" | "usable" | "invalidated";
const STYLES = `[data-huayi-asbplayer-active] .asbplayer-subtitles{visibility:hidden!important}
[data-huayi-store-asbplayer]{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483000;max-width:min(90%,1100px);padding:8px 12px;border:1px solid #ffffff45;border-radius:8px;background:#080808c2;color:white;font:500 clamp(18px,2.2vw,30px)/1.32 Roboto,Arial,sans-serif;text-align:center;text-shadow:0 1px 2px #000,0 0 4px #000;pointer-events:auto}

[data-huayi-asbplayer-english]{user-select:text;cursor:text}[data-huayi-asbplayer-chinese]{user-select:none;font-size:.9em;margin-top:2px}
[data-huayi-store-asbplayer] [hidden]{display:none!important}[data-huayi-store-asbplayer] button,[data-huayi-store-asbplayer] select{font:14px/1.4 system-ui;color:white;background:#222;border:1px solid #ffffff57;border-radius:5px;padding:4px 7px;margin:3px;max-width:100%;text-shadow:none}[data-huayi-store-asbplayer] button[aria-pressed=true]{color:var(--e);border-color:var(--e)}[data-huayi-store-asbplayer] button:disabled{opacity:.5}[data-huayi-store-asbplayer] [data-status]{font:14px/1.5 system-ui;max-width:600px}[data-huayi-store-asbplayer] label{display:block;font:14px/1.5 system-ui}`;
export interface PresentationHost {
  getMount(): HTMLElement | null;
  getEnglish(): HTMLElement;
  destroy(): void;
}
export class AsbplayerPresentation implements PresentationHost {
  readonly host: HTMLElement;
  readonly english: HTMLElement;
  readonly control: HTMLElement;
  readonly fixed: HTMLButtonElement;
  readonly temporary: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly tracks: HTMLElement;
  private readonly en: HTMLSelectElement;
  private readonly zh: HTMLSelectElement;
  private readonly chinese: HTMLElement;
  private readonly unavailable: HTMLElement;
  private readonly style: HTMLStyleElement;
  private player: HTMLElement | null = null;
  private pinned: boolean;
  private holding = false;
  private chineseReady = false;
  private key = "";
  private trackCues: readonly AsbplayerCue[] | null = null;
  private sentences: readonly LocalSentence[] = [];
  constructor(
    private readonly doc: Document,
    options: {
      readonly bilingual: boolean;
      readonly appearance: StoreAppearance;
      readonly confirm: (english: number, chinese: number | null) => void;
      readonly reset: () => void;
      readonly hold: (value: boolean) => void;
    },
  ) {
    this.pinned = options.bilingual;
    this.host = doc.createElement("section");
    this.host.dataset.huayiStoreAsbplayer = "";
    this.host.dataset.bridgeReady = "false";
    this.setAppearance(options.appearance);
    this.style = doc.createElement("style");
    this.style.textContent = STYLES;
    this.status = doc.createElement("div");
    this.status.dataset.status = "";
    this.tracks = doc.createElement("div");
    this.en = doc.createElement("select");
    this.en.ariaLabel = "英语轨道";
    this.zh = doc.createElement("select");
    this.zh.ariaLabel = "中文轨道";
    for (const [label, input] of [
      ["英语轨道", this.en],
      ["中文轨道", this.zh],
    ] as const) {
      const row = doc.createElement("label");
      row.textContent = label;
      row.append(input);
      this.tracks.append(row);
    }
    const confirm = this.button("确认轨道并启用学习字幕", () =>
      options.confirm(
        Number(this.en.value),
        this.zh.value === "none" ? null : Number(this.zh.value),
      ),
    );
    confirm.dataset.confirmTracks = "";
    this.tracks.append(confirm);
    this.english = doc.createElement("div");
    this.chinese = doc.createElement("div");
    this.chinese.dataset.huayiAsbplayerChinese = "";
    this.control = doc.createElement("div");
    this.control.dataset.huayiStoreAsbplayerControl = "";
    this.fixed = this.button("固定中文", () => {
      this.pinned = !this.pinned;
      this.renderChinese();
    });
    this.temporary = this.button("按住显示中文", () => undefined);
    this.temporary.addEventListener("pointerdown", (event) => {
      if (!this.canShowChinese()) return;
      event.preventDefault();
      this.temporary.setPointerCapture?.(event.pointerId);
      options.hold(true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"])
      this.temporary.addEventListener(type, () => options.hold(false));
    this.unavailable = doc.createElement("span");
    this.unavailable.textContent = "未加载中文字幕";
    this.unavailable.style.fontSize = "14px";
    this.temporary.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat && this.canShowChinese()) {
        event.preventDefault();
        options.hold(true);
      }
    });
    this.temporary.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        options.hold(false);
      }
    });
    this.control.append(
      this.unavailable,
      this.fixed,
      this.temporary,
      this.button("更换轨道", options.reset),
    );
    this.host.append(this.status, this.tracks, this.english, this.chinese, this.control);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"])
      this.host.addEventListener(type, (event) => event.stopPropagation());
    (doc.body ?? doc.documentElement).append(this.style, this.host);
  }
  private button(text: string, action: () => void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
  }
  mount(video: HTMLVideoElement | null): boolean {
    const fullscreen = this.doc.fullscreenElement;
    const next = video?.parentElement ?? null;
    if (next !== this.player) {
      this.restoreNative();
      this.player = next;
    }
    const nativeFullscreen = fullscreen instanceof HTMLVideoElement;
    const mount =
      !nativeFullscreen && fullscreen instanceof HTMLElement && fullscreen.contains(video)
        ? fullscreen
        : (next ?? this.doc.body);
    if (mount && this.host.parentElement !== mount) mount.append(this.host);
    if (nativeFullscreen) this.restoreNative();
    this.host.hidden = nativeFullscreen;
    return next !== null && !nativeFullscreen;
  }
  getMount(): HTMLElement | null {
    return this.host.parentElement;
  }
  getEnglish(): HTMLElement {
    return this.english;
  }
  setBridgeReady(): void {
    this.host.dataset.bridgeReady = "true";
  }
  setAppearance(value: StoreAppearance): void {
    setSubtitleAppearance([this.host], value);
  }
  setStatus(status: LearningStatus, message: string, cues: readonly AsbplayerCue[] = []): void {
    this.host.dataset.state = status;
    if (this.status.textContent !== message) this.status.textContent = message;
    this.status.hidden = status === "usable";
    this.tracks.hidden = status !== "waiting-tracks";
    this.control.hidden = status !== "usable";
    this.english.hidden = status !== "usable";
    this.renderChinese();
    if (status === "usable") {
      if (this.player) this.player.dataset.huayiAsbplayerActive = "";
    } else this.restoreNative();
    if (status === "waiting-tracks") {
      if (cues === this.trackCues) return;
      this.trackCues = cues;
      const tracks = describeAsbplayerTracks(cues);
      const key = JSON.stringify(tracks);
      if (key === this.key) return;
      this.key = key;
      this.en.replaceChildren();
      this.zh.replaceChildren();
      const none = this.doc.createElement("option");
      none.value = "none";
      none.textContent = "无中文轨道";
      this.zh.append(none);
      for (const track of tracks)
        for (const select of [this.en, this.zh]) {
          const option = this.doc.createElement("option");
          option.value = String(track.index);
          option.textContent = track.label;
          select.append(option);
        }
    }
  }
  render(sentences: readonly LocalSentence[], chinese: string | null, chineseReady: boolean): void {
    if (
      sentences.length !== this.sentences.length ||
      sentences.some((s, i) => s !== this.sentences[i])
    ) {
      this.sentences = sentences;
      this.english.replaceChildren(
        ...sentences.map((sentence) => {
          const block = this.doc.createElement("div");
          block.dataset.huayiAsbplayerEnglish = String(sentence.id);
          block.textContent = sentence.text;
          return block;
        }),
      );
    }
    this.chinese.textContent = chinese ?? (chineseReady ? "此处无对应中文字幕" : "未选择中文字幕");
    this.chineseReady = chineseReady;
    this.unavailable.hidden = chineseReady;
    this.fixed.disabled = !chineseReady;
    this.temporary.disabled = !chineseReady;
    this.temporary.title = chineseReady ? "按住显示中文字幕" : "中文字幕不可用，请选择中文轨道";
    this.renderChinese();
  }
  canShowChinese(): boolean {
    return this.isUsable() && this.chineseReady;
  }
  isUsable(): boolean {
    return this.host.isConnected && !this.host.hidden && this.host.dataset.state === "usable";
  }
  setBilingual(value: boolean): void {
    this.pinned = value;
    this.renderChinese();
  }
  setHolding(holding: boolean): void {
    this.holding = holding;
    this.renderChinese();
  }
  private renderChinese(): void {
    this.fixed.setAttribute("aria-pressed", String(this.pinned));
    this.temporary.setAttribute("aria-pressed", String(this.holding));
    this.chinese.hidden = !(this.pinned || this.holding) || this.host.dataset.state !== "usable";
  }
  restoreNative(): void {
    if (this.player) delete this.player.dataset.huayiAsbplayerActive;
  }
  destroy(): void {
    this.restoreNative();
    this.host.remove();
    this.style.remove();
    this.sentences = [];
    this.trackCues = null;
  }
}
