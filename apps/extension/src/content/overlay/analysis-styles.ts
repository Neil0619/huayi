import { overlayDesignTokens } from "./style-tokens.js";

export const analysisOverlayStyles = `
  .huayi-analysis-content {
    min-width: 0;
  }

  .huayi-selection-header {
    padding: 15px 0 8px;
  }

  .huayi-source {
    margin: 0;
    color: var(--huayi-muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .huayi-lexeme-header {
    display: flex;
    align-items: baseline;
    gap: 9px;
    flex-wrap: wrap;
    padding: 16px 0 9px;
  }

  .huayi-lexeme-header .huayi-source {
    color: var(--huayi-text);
    font: 34px/1.05 var(--huayi-serif);
    font-weight: 500;
    letter-spacing: -0.035em;
  }

  .huayi-pronunciation {
    margin: 0;
    color: var(--huayi-muted);
    font-size: 12px;
    white-space: pre-wrap;
  }

  .huayi-source-context {
    margin: 8px 0 20px;
    padding: 11px 13px 12px;
    border-left: 2px solid var(--huayi-accent);
    background: var(--huayi-subtle);
  }

  .huayi-context-label {
    display: block;
    margin-bottom: 4px;
    color: #9a9287;
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  .huayi-source-context-copy {
    margin: 0;
    color: #555048;
    font: italic 14px/1.55 var(--huayi-serif);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .huayi-context-highlight {
    padding: 0 2px;
    border-radius: 2px;
    background: #f1d6c7;
    color: #9f3e22;
    font-weight: 500;
  }

  .huayi-section {
    margin-top: 16px;
  }

  .huayi-word-result > .huayi-section:not(.huayi-context-section) {
    padding-top: 15px;
    border-top: 1px solid var(--huayi-border);
  }

  .huayi-enter {
    animation: huayi-enter ${overlayDesignTokens.enterAnimationDuration} ease-out;
  }

  .huayi-section-title {
    margin: 0 0 8px;
    color: #8d8579;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.13em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .huayi-copy {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .huayi-context-section {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 5px 8px;
    margin-top: 0;
    padding: 12px 14px;
    border-left: 2px solid var(--huayi-accent);
    border-radius: 0;
    background: #f7eee7;
  }

  .huayi-context-section .huayi-section-title {
    margin: 0;
    font-size: 10px;
    font-weight: 650;
  }

  .huayi-context-section .huayi-copy {
    grid-column: 1 / -1;
    font: 17px/1.5 var(--huayi-serif);
    line-height: 1.55;
  }

  .huayi-pos-badge {
    display: inline-flex;
    width: max-content;
    min-height: 19px;
    align-items: center;
    padding: 1px 6px;
    border-radius: 4px;
    background: #f0e3d5;
    color: #76523d;
    font-size: 11px;
    font-weight: 650;
    line-height: 1.35;
    white-space: nowrap;
  }

  .huayi-context-section .huayi-pos-badge {
    background: rgba(250, 248, 242, 0.78);
  }

  .huayi-list {
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 0 0 0 18px;
  }

  .huayi-term-list,
  .huayi-entry-list {
    display: grid;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .huayi-term {
    padding: 0;
    background: transparent;
    white-space: pre-wrap;
  }

  .huayi-entry {
    min-width: 0;
  }

  .huayi-entry-primary {
    color: var(--huayi-text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .huayi-entry-secondary,
  .huayi-entry-detail,
  .huayi-meta {
    color: var(--huayi-muted);
    overflow-wrap: anywhere;
  }

  .huayi-entry-detail {
    font-size: 12px;
  }

  .huayi-entry-list--definitions .huayi-entry {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 5px 9px;
  }

  .huayi-entry-list--pairs .huayi-entry,
  .huayi-entry-list--details .huayi-entry {
    display: grid;
    gap: 12px;
  }

  .huayi-entry-list--pairs .huayi-entry {
    grid-template-columns: minmax(150px, 1.25fr) minmax(0, 1fr);
  }

  .huayi-entry-list--details .huayi-entry {
    grid-template-columns: minmax(110px, 0.9fr) minmax(0, 1.35fr);
  }

  .huayi-entry-list--details .huayi-entry-primary {
    color: var(--huayi-muted);
    font-weight: 500;
  }

  .huayi-entry-list--comparisons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 18px;
  }

  .huayi-entry-list--comparisons .huayi-entry {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 3px 7px;
  }

  .huayi-entry-list--comparisons .huayi-entry-secondary,
  .huayi-entry-list--comparisons .huayi-entry-detail {
    grid-column: 1 / -1;
  }

  @media (prefers-reduced-motion: reduce) {
    .huayi-enter {
      animation: none;
    }
  }

  @media (max-width: 460px) {
    .huayi-lexeme-header .huayi-source {
      font-size: 30px;
    }

    .huayi-entry-list--pairs .huayi-entry,
    .huayi-entry-list--comparisons {
      grid-template-columns: 1fr;
    }

    .huayi-entry-list--pairs .huayi-entry {
      gap: 2px;
    }

    .huayi-entry-list--details .huayi-entry {
      grid-template-columns: minmax(78px, 0.55fr) minmax(0, 1.45fr);
      gap: 8px;
    }
  }
`;
