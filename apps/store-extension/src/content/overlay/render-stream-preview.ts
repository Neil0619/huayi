import type { AnalysisUpdate } from "@huayi/store-domain";

import { previewStructuredSection, previewTextSection } from "./result-section-specs.js";
import { renderResultSection } from "./render-result-sections.js";

function patchSection(
  body: HTMLElement,
  key: string,
  rendered: HTMLElement,
  signature: string,
): void {
  const current = body.querySelector<HTMLElement>(`[data-result-section="${key}"]`);
  if (current?.dataset.previewSignature === signature) return;
  rendered.dataset.previewSignature = signature;
  if (current === null) body.append(rendered);
  else current.replaceWith(rendered);
}

export function renderStreamPreview(
  body: HTMLElement,
  textPreview: ReadonlyMap<Extract<AnalysisUpdate, { type: "delta" }>["section"], string>,
  structuredPreview: ReadonlyMap<
    Extract<AnalysisUpdate, { type: "section" }>["section"],
    Extract<AnalysisUpdate, { type: "section" }>
  >,
): void {
  for (const item of body.querySelectorAll(":scope > .status, :scope > .loading-skeleton")) {
    item.remove();
  }
  for (const [section, value] of textPreview) {
    const spec = previewTextSection(section, value);
    patchSection(
      body,
      section,
      renderResultSection(body.ownerDocument, spec),
      JSON.stringify(spec),
    );
  }
  for (const [section, update] of structuredPreview) {
    const spec = previewStructuredSection(update);
    if (spec !== null) {
      patchSection(
        body,
        section,
        renderResultSection(body.ownerDocument, spec),
        JSON.stringify(spec),
      );
    }
  }
}

export function renderStreamStatus(body: HTMLElement): void {
  const status = body.ownerDocument.createElement("p");
  status.className = "status";
  status.textContent = "正在分析…";
  const skeleton = body.ownerDocument.createElement("div");
  skeleton.className = "loading-skeleton";
  skeleton.dataset.loadingSkeleton = "";
  skeleton.ariaHidden = "true";
  for (const width of ["42%", "88%", "69%"] as const) {
    const line = body.ownerDocument.createElement("span");
    line.className = "loading-line";
    line.style.width = width;
    skeleton.append(line);
  }
  body.replaceChildren(status, skeleton);
}
