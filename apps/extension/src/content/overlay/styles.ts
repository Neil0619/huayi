export const overlayDesignTokens = {
  accent: "#2266f5",
  background: "#f4f5f7",
  border: "#dde0e5",
  danger: "#b42318",
  mutedText: "#737780",
  panelWidth: "420px",
  radius: "14px",
  shadow: "0 10px 30px rgba(22, 26, 35, 0.18)",
  text: "#16181d",
} as const;

export const overlayStyles = `
  :host {
    all: initial;
    color-scheme: light;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  .huayi-root {
    --huayi-accent: ${overlayDesignTokens.accent};
    --huayi-background: ${overlayDesignTokens.background};
    --huayi-border: ${overlayDesignTokens.border};
    --huayi-muted: ${overlayDesignTokens.mutedText};
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
    gap: 2px;
    min-height: 42px;
    padding: 5px;
    border: 1px solid rgba(20, 24, 32, 0.08);
    border-radius: 13px;
    background: #ffffff;
    box-shadow: ${overlayDesignTokens.shadow};
  }

  .huayi-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 5px 11px;
    border-radius: 9px;
    background: transparent;
    white-space: nowrap;
  }

  .huayi-action:hover {
    background: #f0f2f5;
  }

  .huayi-action-icon {
    color: var(--huayi-accent);
    font-size: 13px;
    font-weight: 650;
  }

  .huayi-panel {
    width: min(${overlayDesignTokens.panelWidth}, calc(100vw - 16px));
    max-height: 70vh;
    overflow: hidden;
    border: 1px solid var(--huayi-border);
    border-radius: ${overlayDesignTokens.radius};
    background: var(--huayi-background);
    box-shadow: ${overlayDesignTokens.shadow};
  }

  .huayi-header {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    min-height: 44px;
    padding: 7px 10px 5px 16px;
  }

  .huayi-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }

  .huayi-drag-handle {
    position: absolute;
    top: 5px;
    left: 50%;
    width: 28px;
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
    left: 7px;
    width: 14px;
    height: 2px;
    border-radius: 2px;
    background: #c4c7cd;
  }

  .huayi-close {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 8px;
    background: transparent;
    color: #6f737b;
    font-size: 20px;
    line-height: 1;
  }

  .huayi-close:hover {
    background: #e7e9ed;
  }

  .huayi-body {
    max-height: calc(70vh - 44px);
    overflow: auto;
    padding: 2px 16px 18px;
    overscroll-behavior: contain;
  }

  .huayi-source {
    margin: 0 0 12px;
    padding-left: 9px;
    border-left: 2px solid #c9ccd2;
    color: var(--huayi-muted);
    white-space: pre-wrap;
  }

  .huayi-section {
    margin-top: 14px;
  }

  .huayi-section:first-child {
    margin-top: 0;
  }

  .huayi-section-title {
    margin: 0 0 5px;
    font-size: 14px;
    font-weight: 700;
  }

  .huayi-copy {
    margin: 0;
    white-space: pre-wrap;
  }

  .huayi-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0 0 0 18px;
  }

  .huayi-term-list {
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .huayi-term {
    padding: 7px 9px;
    border: 1px solid #e1e3e7;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.68);
  }

  .huayi-meta {
    color: var(--huayi-muted);
  }

  .huayi-loading,
  .huayi-error {
    display: grid;
    justify-items: center;
    gap: 10px;
    min-height: 132px;
    padding: 22px 8px 8px;
    text-align: center;
  }

  .huayi-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #d7dbe3;
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

  @keyframes huayi-spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 460px) {
    .huayi-panel {
      width: calc(100vw - 16px);
    }

    .huayi-body {
      padding-right: 13px;
      padding-left: 13px;
    }
  }
`;
