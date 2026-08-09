import { youtubeCaptionStyles } from "./youtube-caption-styles.js";

export interface YouTubeCaptionView {
  controlHost: HTMLElement;
  english: HTMLElement;
  host: HTMLElement;
  translated: HTMLElement;
  destroy(): void;
  mountControl(player: HTMLElement): boolean;
  setBilingualControl(ready: boolean, pinned: boolean): void;
  update(english: string, translated: string | null, showTranslation: boolean): void;
}

export function createYouTubeCaptionView(
  documentRef: Document,
  player: HTMLElement,
  onToggleBilingual: () => void,
): YouTubeCaptionView {
  const style = documentRef.createElement("style");
  style.dataset.huayiYoutubeSubtitleStyle = "";
  style.textContent = youtubeCaptionStyles;
  const host = documentRef.createElement("section");
  host.dataset.huayiYoutubeSubtitleSurface = "";
  host.setAttribute("aria-live", "off");
  const box = documentRef.createElement("div");
  box.dataset.huayiYoutubeCaptionBox = "";
  const english = documentRef.createElement("div");
  english.dataset.huayiYoutubeEnglish = "";
  const translated = documentRef.createElement("div");
  translated.dataset.huayiYoutubeTranslated = "";
  translated.setAttribute("aria-hidden", "true");
  translated.hidden = true;
  box.append(english, translated);
  host.append(box);

  const controlHost = documentRef.createElement("div");
  controlHost.dataset.huayiYoutubeControlHost = "";
  const button = documentRef.createElement("button");
  button.dataset.huayiYoutubeBilingual = "";
  button.type = "button";
  button.textContent = "中";
  button.disabled = true;
  button.title = "中文字幕尚未就绪";
  button.setAttribute("aria-label", "固定显示中文字幕");
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", onToggleBilingual);
  controlHost.append(button);

  const mountControl = (targetPlayer: HTMLElement): boolean => {
    if (controlHost.isConnected) return true;
    const subtitlesButton = targetPlayer.querySelector<HTMLElement>(".ytp-subtitles-button");
    if (subtitlesButton?.parentElement === null || subtitlesButton === null) return false;
    subtitlesButton.before(controlHost);
    return true;
  };

  player.append(style, host);
  mountControl(player);

  return {
    controlHost,
    english,
    host,
    translated,
    destroy: () => {
      controlHost.remove();
      host.remove();
      style.remove();
    },
    mountControl,
    setBilingualControl: (ready, pinned) => {
      const disabled = !ready;
      const title = ready ? "固定显示中文字幕（按住 F8 临时显示）" : "中文字幕尚未就绪";
      const pressed = String(ready && pinned);
      if (button.disabled !== disabled) button.disabled = disabled;
      if (button.title !== title) button.title = title;
      if (button.getAttribute("aria-pressed") !== pressed) {
        button.setAttribute("aria-pressed", pressed);
      }
    },
    update: (englishText, translatedText, showTranslation) => {
      if (english.textContent !== englishText) english.textContent = englishText;
      if (translated.textContent !== (translatedText ?? "")) {
        translated.textContent = translatedText ?? "";
      }
      const visible = showTranslation && translatedText !== null;
      if (translated.hidden === visible) translated.hidden = !visible;
      const ariaHidden = String(!visible);
      if (translated.getAttribute("aria-hidden") !== ariaHidden) {
        translated.setAttribute("aria-hidden", ariaHidden);
      }
    },
  };
}
