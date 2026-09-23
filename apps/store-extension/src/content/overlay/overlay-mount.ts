import type { AnalysisAction, StoreAppearance, StoreOverlayTheme } from "@huayi/store-domain";
import { createOverlayHost, applyOverlayAppearance } from "./overlay-visual-state.js";
import { createOverlayPanel } from "./overlay-panel.js";
import { attachOverlayStyles } from "./overlay-stylesheet.js";
import type { StoreOverlayAnchor } from "./overlay-runtime.js";
export function mountOverlayPanel({
  document,
  anchor,
  appearance,
  theme,
  mount,
  stylesheetUrl,
  action,
  stop,
  position,
}: {
  readonly document: Document;
  readonly anchor: StoreOverlayAnchor;
  readonly appearance: StoreAppearance;
  readonly theme: StoreOverlayTheme;
  readonly mount: HTMLElement | null;
  readonly stylesheetUrl: string;
  readonly action: (action: AnalysisAction, event: Event) => void;
  readonly stop: () => void;
  readonly position: () => void;
}) {
  const { host, shadow } = createOverlayHost(document, anchor);
  const view = createOverlayPanel(document, theme, action, stop);
  applyOverlayAppearance(host, appearance, view.panel);
  attachOverlayStyles(document, shadow, view.panel, stylesheetUrl, position);
  (mount ?? document.body ?? document.documentElement).append(host);
  return { host, ...view };
}

export function relocateOverlayHost(host: HTMLElement | null, mount: HTMLElement | null): void {
  if (!host) return;
  const document = host.ownerDocument;
  const target = mount ?? document.body ?? document.documentElement;
  if (host.parentElement !== target) target.append(host);
}
