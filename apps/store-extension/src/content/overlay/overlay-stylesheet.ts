import { STORE_OVERLAY_FALLBACK_STYLES } from "./overlay-styles.js";

export function attachOverlayStyles(
  document: Document,
  shadow: ShadowRoot,
  panel: HTMLElement,
  href: string,
): void {
  const fallback = document.createElement("style");
  fallback.textContent = STORE_OVERLAY_FALLBACK_STYLES;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  stylesheet.dataset.overlayStylesheet = "";
  panel.dataset.styles = "loading";
  stylesheet.addEventListener("load", () => {
    panel.dataset.styles = "ready";
  });
  stylesheet.addEventListener("error", () => {
    panel.dataset.styles = "fallback";
  });
  shadow.append(fallback, stylesheet, panel);
}
