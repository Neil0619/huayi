export const toolbarOverlayStyles = `
  .huayi-toolbar {
    display: grid;
    width: min(370px, calc(100vw - 16px));
    padding: 11px;
    border: 1px solid var(--huayi-border);
    border-radius: 13px;
    background: var(--huayi-background);
    box-shadow: var(--huayi-shadow);
  }

  .huayi-toolbar-selection {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 6px 12px;
    padding: 2px 6px 11px;
    border-bottom: 1px solid var(--huayi-border);
  }

  .huayi-toolbar-selection-label {
    grid-column: 2;
    grid-row: 1;
    color: var(--huayi-muted);
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  .huayi-toolbar-selection-text {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--huayi-text);
    font: 21px/1.25 var(--huayi-serif);
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .huayi-toolbar-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding-top: 9px;
  }

  .huayi-toolbar-actions > :only-child {
    grid-column: 1 / -1;
  }

  .huayi-action {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 9px;
    min-height: 66px;
    padding: 12px 11px;
    border: 1px solid var(--huayi-border);
    border-radius: 8px;
    background: #fffdf8;
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
  }

  .huayi-action:hover {
    border-color: var(--huayi-accent);
    background: #fff8f3;
    transform: translateY(-1px);
  }

  .huayi-action[data-emphasis="primary"] {
    border-color: #d6b5a7;
    background: #fff8f2;
  }

  .huayi-action-icon {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 5px;
    background: var(--huayi-accent-soft);
    color: var(--huayi-accent);
    font-size: 12px;
    font-weight: 700;
  }

  .huayi-action-copy {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  .huayi-action-label {
    font-size: 13px;
    font-weight: 650;
  }

  .huayi-action-description {
    color: var(--huayi-muted);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
`;
