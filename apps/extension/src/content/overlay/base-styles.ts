import { overlayDesignTokens } from "./style-tokens.js";

export const baseOverlayStyles = `
  :host {
    all: initial;
    color-scheme: light;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  .huayi-root {
    --huayi-accent: ${overlayDesignTokens.terracotta};
    --huayi-accent-soft: ${overlayDesignTokens.terracottaSoft};
    --huayi-background: ${overlayDesignTokens.paper};
    --huayi-border: ${overlayDesignTokens.fineRule};
    --huayi-muted: ${overlayDesignTokens.muted};
    --huayi-subtle: ${overlayDesignTokens.subtleSurface};
    --huayi-text: ${overlayDesignTokens.ink};
    --huayi-shadow: ${overlayDesignTokens.subtleShadow};
    --huayi-serif: Georgia, "Times New Roman", serif;
    --huayi-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    position: fixed;
    z-index: 2147483647;
    margin: 0;
    color: var(--huayi-text);
    font: 14px/1.55 var(--huayi-sans);
    letter-spacing: normal;
    text-align: left;
    pointer-events: auto;
  }

  button {
    margin: 0;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:focus-visible {
    outline: 2px solid var(--huayi-accent);
    outline-offset: 2px;
  }

  .huayi-panel {
    display: flex;
    flex-direction: column;
    width: min(${overlayDesignTokens.panelWidth}, calc(100vw - 16px));
    max-height: min(72vh, 680px);
    overflow: hidden;
    border: 1px solid var(--huayi-border);
    border-radius: ${overlayDesignTokens.radius};
    background: var(--huayi-background);
    box-shadow: ${overlayDesignTokens.subtleShadow};
  }

  .huayi-header {
    position: sticky;
    z-index: 2;
    top: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    flex: 0 0 auto;
    min-height: 52px;
    padding: 10px 10px 9px 18px;
    border-bottom: 1px solid var(--huayi-border);
    background: rgba(250, 248, 242, 0.96);
  }

  .huayi-title {
    min-width: 0;
    margin: 0;
    color: var(--huayi-muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .huayi-drag-handle {
    position: absolute;
    top: 3px;
    left: 50%;
    width: 32px;
    height: 14px;
    padding: 0;
    transform: translateX(-50%);
    border-radius: 8px;
    background: transparent;
    touch-action: none;
    cursor: grab;
  }

  .huayi-drag-handle::after {
    content: "";
    position: absolute;
    top: 5px;
    left: 8px;
    width: 16px;
    height: 2px;
    border-radius: 2px;
    background: #aaa196;
  }

  .huayi-close {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: 9px;
    background: transparent;
    color: var(--huayi-muted);
    font-size: 19px;
    line-height: 1;
    transition: background 100ms ease, color 100ms ease;
  }

  .huayi-close:hover {
    background: var(--huayi-subtle);
    color: var(--huayi-text);
  }

  .huayi-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    min-height: 32px;
  }

  .huayi-body {
    min-height: 0;
    overflow: auto;
    padding: 0 18px 20px;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .huayi-panel[data-status="loading"] .huayi-body,
  .huayi-panel[data-status="streaming"][data-selection-kind="word"] .huayi-body {
    min-height: 208px;
  }

  .huayi-error {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 10px;
    min-height: 168px;
    padding: 20px 8px 10px;
    text-align: center;
  }

  .huayi-loading {
    display: grid;
    gap: 13px;
    padding: 18px 0 4px;
    border-top: 1px solid var(--huayi-border);
  }

  .huayi-loading-status {
    margin: 0;
    color: var(--huayi-muted);
    font-size: 11px;
    letter-spacing: 0.08em;
  }

  .huayi-loading-skeleton {
    display: grid;
    gap: 10px;
  }

  .huayi-loading-line {
    display: block;
    height: 8px;
    border-radius: 2px;
    background: linear-gradient(90deg, #e8e0d5, #f3ede4 55%, #e8e0d5);
    background-size: 220% 100%;
    animation: huayi-skeleton 1.6s ease-in-out infinite;
  }

  .huayi-slow-hint {
    margin: 0;
    color: var(--huayi-muted);
    font-size: 12px;
  }

  .huayi-retry {
    padding: 7px 14px;
    border-radius: 9px;
    background: var(--huayi-accent);
    color: #ffffff;
  }

  .huayi-wordbook {
    display: flex;
    align-items: center;
    min-height: 32px;
  }

  .huayi-wordbook-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    padding: 4px 8px;
    border-radius: 9px;
    background: var(--huayi-accent-soft);
    color: var(--huayi-accent);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    transition: background 100ms ease, color 100ms ease;
  }

  .huayi-wordbook-button:hover:not(:disabled) {
    background: var(--huayi-accent-soft);
  }

  .huayi-wordbook-button:disabled {
    color: var(--huayi-muted);
    cursor: default;
  }

  .huayi-wordbook-button[data-wordbook-status="present"] {
    background: #eef5f1;
    color: #426b58;
  }

  .huayi-wordbook-button[data-wordbook-status="saving"] {
    background: var(--huayi-subtle);
  }

  .huayi-wordbook-icon {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
  }

  .huayi-wordbook-error {
    flex: 0 0 auto;
    margin: 0 18px 6px;
    padding: 7px 10px;
    border-radius: 8px;
    background: #fff1f0;
    color: ${overlayDesignTokens.danger};
    font-size: 12px;
  }

  .huayi-preview-incomplete {
    margin: 14px 0 0;
    color: ${overlayDesignTokens.danger};
    font-size: 12px;
    font-weight: 600;
  }

  .huayi-error-inline {
    min-height: 0;
    margin-top: 12px;
    padding: 12px 8px 2px;
    border-top: 1px solid var(--huayi-border);
  }

  @keyframes huayi-skeleton {
    0%, 100% { background-position: 100% 0; }
    50% { background-position: 0 0; }
  }

  @keyframes huayi-enter {
    from {
      opacity: 0;
      transform: translateY(${overlayDesignTokens.enterTranslateOffset});
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .huayi-action,
    .huayi-close,
    .huayi-wordbook-button {
      transition: none;
    }

    .huayi-enter {
      animation: none;
    }

    .huayi-loading-line {
      animation: none;
    }
  }

  @media (max-width: 460px) {
    .huayi-panel {
      width: calc(100vw - 16px);
    }

    .huayi-body {
      padding-right: 14px;
      padding-left: 14px;
    }

    .huayi-header {
      padding-left: 14px;
    }

    .huayi-toolbar-actions {
      gap: 6px;
    }

    .huayi-action {
      padding: 11px 9px;
    }

    .huayi-action-description {
      font-size: 10px;
    }
  }
`;
