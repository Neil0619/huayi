import { initializeBackfillPanel } from "../backfill/backfill-panel.js";

export function initializeOptionsBackfillPanel(
  document: Document,
  options: Omit<Parameters<typeof initializeBackfillPanel>[0], "container">,
) {
  const container = document.querySelector<HTMLElement>("[data-options-backfill-mount]");
  if (container) return initializeBackfillPanel({ ...options, container });
  return undefined;
}
