import type { AnalysisAction, StoreOverlayTheme } from "@huayi/store-domain";

interface OverlayPanel {
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  readonly headerActions: HTMLElement;
  readonly panel: HTMLElement;
  readonly promoteToResult: () => void;
}

function actionButton(
  document: Document,
  label: string,
  action: AnalysisAction,
  onAction: (action: AnalysisAction, event: Event) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.addEventListener("click", (event) => onAction(action, event));
  return button;
}

export function createOverlayPanel(
  document: Document,
  theme: StoreOverlayTheme,
  onAction: (action: AnalysisAction, event: Event) => void,
  onClose: () => void,
  onStop: () => void,
): OverlayPanel {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.dataset.card = "action";
  panel.dataset.theme = theme;
  panel.setAttribute("aria-label", "语见分析");
  panel.setAttribute("role", "dialog");

  const header = document.createElement("div");
  header.className = "header action-header";
  const modes = document.createElement("div");
  modes.className = "mode-actions";
  modes.append(
    actionButton(document, "解释", "explain", onAction),
    actionButton(document, "翻译", "translate", onAction),
  );
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.dataset.close = "";
  close.setAttribute("aria-label", "关闭解释卡片");
  close.title = "关闭（Esc）；生成将在后台继续";
  close.addEventListener("click", onClose);
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "停止";
  stop.dataset.stop = "";
  stop.hidden = true;
  stop.addEventListener("click", onStop);
  header.append(modes);

  const body = document.createElement("div");
  body.className = "body";
  body.dataset.analysisBody = "";
  body.setAttribute("aria-live", "polite");
  const footer = document.createElement("div");
  footer.className = "footer";
  panel.append(header, body, footer);
  return {
    body,
    footer,
    headerActions,
    panel,
    promoteToResult: () => {
      if (panel.dataset.card !== "action") return;
      const mark = document.createElement("span");
      mark.className = "brand-mark";
      mark.dataset.brandMark = "";
      mark.ariaHidden = "true";
      const brand = document.createElement("p");
      brand.className = "eyebrow";
      brand.textContent = "SEEN & SAID";
      panel.dataset.card = "result";
      header.className = "header";
      header.replaceChildren(mark, brand, modes, headerActions, stop, close);
    },
  };
}
