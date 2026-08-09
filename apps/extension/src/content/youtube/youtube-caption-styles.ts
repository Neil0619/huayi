export const youtubeCaptionStyles = `
  [data-huayi-youtube-subtitles-active] .ytp-caption-window-container {
    visibility: hidden !important;
  }

  [data-huayi-youtube-subtitle-surface] {
    position: absolute;
    z-index: 59;
    left: 50%;
    bottom: max(64px, 9%);
    display: flex;
    max-width: min(90%, 1100px);
    flex-direction: column;
    align-items: center;
    transform: translateX(-50%);
    color: #fff;
    font-family: Roboto, Arial, sans-serif;
    font-size: clamp(18px, 2.2vw, 30px);
    font-weight: 500;
    line-height: 1.32;
    text-align: center;
    text-shadow: 0 1px 2px #000, 0 0 4px #000;
    pointer-events: auto;
  }

  [data-huayi-youtube-caption-box] {
    position: relative;
    display: inline-flex;
    max-width: 100%;
    padding: 4px 10px;
    flex-direction: column;
    border-radius: 6px;
    background: rgba(8, 8, 8, 0.72);
  }

  [data-huayi-youtube-temporary-translation] {
    position: absolute;
    top: -9px;
    right: -9px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 999px;
    background: rgba(18, 18, 18, 0.82);
    color: rgba(255, 255, 255, 0.92);
    font: 650 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
    opacity: 0.88;
  }

  [data-huayi-youtube-temporary-translation]:hover,
  [data-huayi-youtube-temporary-translation][aria-pressed="true"] {
    border-color: #67e8f9;
    color: #67e8f9;
    opacity: 1;
  }

  [data-huayi-youtube-temporary-translation]:focus-visible {
    outline: 2px solid #67e8f9;
    outline-offset: 2px;
  }

  [data-huayi-youtube-english] {
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  [data-huayi-youtube-translated] {
    margin-top: 2px;
    font-size: 0.9em;
    font-weight: 450;
    user-select: none;
    -webkit-user-select: none;
  }

  [data-huayi-youtube-control-host] {
    display: inline-flex;
    float: left;
    width: 48px;
    height: 100%;
    align-items: center;
    justify-content: center;
  }

  [data-huayi-youtube-bilingual] {
    width: 48px;
    height: 100%;
    min-height: 36px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #fff;
    font: 700 16px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
    cursor: pointer;
    opacity: 0.92;
  }

  [data-huayi-youtube-bilingual][aria-pressed="true"] {
    color: #67e8f9;
  }

  [data-huayi-youtube-bilingual]:disabled {
    cursor: default;
    opacity: 0.38;
  }

  [data-huayi-youtube-bilingual]:focus-visible {
    outline: 2px solid #67e8f9;
    outline-offset: -4px;
  }

  .ytp-fullscreen [data-huayi-youtube-subtitle-surface] {
    bottom: max(76px, 8%);
    font-size: clamp(24px, 2.5vw, 42px);
  }
`;
