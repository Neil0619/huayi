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
  host.style.left = `${anchor.left}px`;
  host.style.top = `${anchor.bottom + 8}px`;
  return { host, shadow: host.attachShadow({ mode: "open" }) };
}

// Undefined keeps the compact action card; null chooses a side for a newly promoted result.
export type OverlayPlacement = "above" | "below" | "viewport" | null | undefined;

export function positionOverlayHost(
  host: HTMLElement,
  anchor: StoreOverlayAnchor,
  side?: OverlayPlacement,
): OverlayPlacement {
  const view = host.ownerDocument.defaultView;
  if (view === null) return side;
  const viewport = view.visualViewport;
  const gutter = 8;
  const viewportLeft = (viewport?.offsetLeft ?? 0) + gutter;
  const viewportTop = (viewport?.offsetTop ?? 0) + gutter;
  const viewportRight = viewportLeft + (viewport?.width ?? view.innerWidth) - gutter * 2;
  const viewportBottom = viewportTop + (viewport?.height ?? view.innerHeight) - gutter * 2;
  const clampY = (value: number): number => Math.max(viewportTop, Math.min(value, viewportBottom));
  const below = clampY(anchor.bottom + gutter);
  const above = clampY(anchor.top - gutter);
  if (side !== undefined) {
    const belowSpace = viewportBottom - below;
    const aboveSpace = above - viewportTop;
    // Reserve a useful reading area before the first delta, rather than fitting only the skeleton.
    // If neither side has room, overlap the selection to keep the body readable in short windows.
    if (side === null) {
      side =
        Math.max(belowSpace, aboveSpace) < 300 ? "viewport" : belowSpace >= 300 ? "below" : "above";
    }
    host.style.setProperty(
      "--overlay-available-height",
      `${Math.max(1, side === "viewport" ? viewportBottom - viewportTop : side === "below" ? belowSpace : aboveSpace)}px`,
    );
  } else {
    host.style.removeProperty("--overlay-available-height");
  }
  // Measure after applying the cap so the panel's existing scrollable body stays inside this side.
  const bounds = host.getBoundingClientRect();
  const left = Math.max(
    viewportLeft,
    Math.min(anchor.left - bounds.width / 2, viewportRight - bounds.width),
  );
  const top =
    side === "viewport"
      ? viewportTop
      : side === "below" || (side === undefined && below + bounds.height <= viewportBottom)
        ? below
        : above - bounds.height;
  host.style.left = `${left}px`;
  host.style.top = `${Math.max(viewportTop, Math.min(top, viewportBottom - bounds.height))}px`;
  return side;
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
  const stop = host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-stop]");
  if (stop) {
    stop.hidden = !loading;
    stop.disabled = false;
  }
  for (const button of host?.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-action]") ??
    []) {
    const active = button.dataset.action === action;
    button.disabled = loading && active;
    button.dataset.active = String(active);
    button.setAttribute("aria-pressed", String(active));
  }
}
