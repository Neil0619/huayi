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
    --huayi-accent: ${overlayDesignTokens.accent};
    --huayi-accent-soft: ${overlayDesignTokens.accentSoft};
    --huayi-background: ${overlayDesignTokens.background};
    --huayi-border: ${overlayDesignTokens.border};
    --huayi-muted: ${overlayDesignTokens.mutedText};
    --huayi-subtle: ${overlayDesignTokens.subtleBackground};
    --huayi-text: ${overlayDesignTokens.text};
    position: fixed;
    z-index: 2147483647;
    margin: 0;
    color: var(--huayi-text);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

  .huayi-toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    min-height: 40px;
    padding: 4px;
    border: 1px solid rgba(15, 23, 42, 0.09);
    border-radius: 12px;
    background: var(--huayi-background);
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.08);
  }

  .huayi-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 31px;
    padding: 5px 10px;
    border-radius: 8px;
    background: transparent;
    white-space: nowrap;
    transition: background 100ms ease, color 100ms ease;
  }

  .huayi-action:hover {
    background: var(--huayi-subtle);
  }

  .huayi-action-icon {
    display: grid;
    width: 19px;
    height: 19px;
    place-items: center;
    border-radius: 6px;
    background: var(--huayi-accent-soft);
    color: var(--huayi-accent);
    font-size: 11px;
    font-weight: 700;
  }

  .huayi-panel {
    display: flex;
    flex-direction: column;
    width: min(${overlayDesignTokens.panelWidth}, calc(100vw - 16px));
    max-height: min(72vh, 680px);
    overflow: hidden;
    border: 1px solid rgba(15, 23, 42, 0.1);
    border-radius: ${overlayDesignTokens.radius};
    background: var(--huayi-background);
    box-shadow: ${overlayDesignTokens.shadow};
  }

  .huayi-header {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    flex: 0 0 auto;
    min-height: 45px;
    padding: 9px 10px 4px 18px;
  }

  .huayi-title {
    min-width: 0;
    margin: 0;
    color: var(--huayi-muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
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
    background: #c7cbd2;
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

  .huayi-loading,
  .huayi-error {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 10px;
    min-height: 168px;
    padding: 20px 8px 10px;
    text-align: center;
  }

  .huayi-spinner {
    width: 22px;
    height: 22px;
    border: 2px solid #dce2eb;
    border-top-color: var(--huayi-accent);
    border-radius: 50%;
    animation: huayi-spin 0.8s linear infinite;
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
    background: transparent;
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

  @keyframes huayi-spin {
    to { transform: rotate(360deg); }
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
  }
`;
