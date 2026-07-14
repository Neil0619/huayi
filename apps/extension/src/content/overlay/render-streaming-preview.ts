import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";
import { patchAnalysisBody } from "./patch-analysis-body.js";

export function renderStreamingPreview(
  state: StreamingOverlayState | ErrorOverlayState,
): HTMLElement {
  const body = document.createElement("div");
  patchAnalysisBody(body, state);
  const preview = body.querySelector<HTMLElement>(":scope > .huayi-preview");
  if (preview === null) {
    throw new Error("Streaming preview requires preview content.");
  }
  return preview;
}
