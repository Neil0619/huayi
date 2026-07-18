import { overlayDesignTokens } from "../overlay/style-tokens.js";

export const youtubeControlStyles = `
  :host {
    all: initial;
    display: inline-block;
    float: left;
    width: 48px;
    height: 100%;
    vertical-align: top;
  }

  button {
    display: grid;
    width: 48px;
    height: 100%;
    min-height: 36px;
    margin: 0;
    padding: 0;
    place-items: center;
    border: 0;
    background: transparent;
    color: #ffffff;
    font: 700 16px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
    cursor: pointer;
    opacity: 0.92;
  }

  button:hover,
  button[aria-pressed="true"] {
    color: #8bb8ff;
    opacity: 1;
  }

  button:focus-visible {
    outline: 2px solid #8bb8ff;
    outline-offset: -4px;
  }

  button:disabled {
    cursor: default;
    opacity: 0.38;
  }
`;

export const youtubePickerStyles = `
  :host {
    all: initial;
    position: absolute;
    z-index: 2147483646;
    left: 50%;
    bottom: 68px;
    width: min(760px, calc(100% - 40px));
    transform: translateX(-50%);
    color-scheme: light;
    pointer-events: auto;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  .huayi-caption-picker {
    overflow: hidden;
    border: 1px solid rgba(15, 23, 42, 0.14);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: ${overlayDesignTokens.shadow};
    color: ${overlayDesignTokens.text};
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: normal;
    text-align: left;
    backdrop-filter: blur(10px);
  }

  .huayi-caption-copy {
    padding: 12px 44px 10px 16px;
    user-select: none;
  }

  .huayi-caption-word {
    display: inline;
    margin: 0;
    padding: 1px 2px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }

  .huayi-caption-word:hover {
    background: ${overlayDesignTokens.subtleBackground};
  }

  .huayi-caption-word[data-selected="true"] {
    background: ${overlayDesignTokens.accentSoft};
    color: ${overlayDesignTokens.accent};
  }

  .huayi-caption-word:focus-visible,
  .huayi-caption-action:focus-visible,
  .huayi-caption-close:focus-visible {
    outline: 2px solid ${overlayDesignTokens.accent};
    outline-offset: 2px;
  }

  .huayi-caption-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 42px;
    padding: 6px 10px 7px 14px;
    border-top: 1px solid ${overlayDesignTokens.border};
    color: ${overlayDesignTokens.mutedText};
    font-size: 12px;
  }

  .huayi-caption-actions {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .huayi-caption-action,
  .huayi-caption-close {
    margin: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  }

  .huayi-caption-action {
    min-height: 30px;
    padding: 6px 10px;
  }

  .huayi-caption-action:hover {
    background: ${overlayDesignTokens.subtleBackground};
    color: ${overlayDesignTokens.text};
  }

  .huayi-caption-action[data-primary="true"] {
    background: ${overlayDesignTokens.accent};
    color: #ffffff;
  }

  .huayi-caption-action[data-primary="true"]:hover {
    background: #1d4ed8;
    color: #ffffff;
  }

  .huayi-caption-close {
    position: absolute;
    top: 8px;
    right: 9px;
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    color: ${overlayDesignTokens.mutedText};
    font-size: 18px;
  }

  .huayi-caption-close:hover {
    background: ${overlayDesignTokens.subtleBackground};
    color: ${overlayDesignTokens.text};
  }

  @media (max-width: 520px) {
    :host {
      bottom: 58px;
      width: calc(100% - 16px);
    }

    .huayi-caption-picker {
      font-size: 14px;
    }

    .huayi-caption-footer {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .huayi-caption-word {
      transition: none;
    }
  }
`;
