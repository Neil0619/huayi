import type { AnalysisAction, StoreAppearance, StoreOverlayTheme } from "@huayi/store-domain";

import type { StoreOverlayAnchor } from "./overlay-runtime.js";

export function createOverlayHost(
  documentRef: Document,
  anchor: StoreOverlayAnchor,
): { readonly host: HTMLElement; readonly shadow: ShadowRoot } {
  const host = documentRef.createElement("div");
  host.dataset.huayiStoreOverlay = "";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 32))}px`;
  host.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - 32))}px`;
  return { host, shadow: host.attachShadow({ mode: "open" }) };
}

export function applyOverlayAppearance(
  host: HTMLElement | null,
  appearance: StoreAppearance,
  panel: HTMLElement | null | undefined = host?.shadowRoot?.querySelector<HTMLElement>(".panel"),
): void {
  if (host === null) return;
  host.dataset.appearance = appearance;
  if (panel !== null && panel !== undefined) panel.dataset.appearance = appearance;
}

export function applyOverlayTheme(host: HTMLElement | null, theme: StoreOverlayTheme): void {
  const panel = host?.shadowRoot?.querySelector<HTMLElement>(".panel");
  if (panel !== null && panel !== undefined) panel.dataset.theme = theme;
}

export function updateOverlayModeControls(
  host: HTMLElement | null,
  action: AnalysisAction,
  loading: boolean,
): void {
  for (const button of host?.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-action]") ??
    []) {
    const active = button.dataset.action === action;
    button.disabled = loading && active;
    button.dataset.active = String(active);
    button.setAttribute("aria-pressed", String(active));
  }
}
