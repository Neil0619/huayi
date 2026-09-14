import type { AnalysisResult } from "@huayi/store-domain";

import { reconcileMainStructure } from "./render-main-structure.js";
import { renderResultSection } from "./render-result-sections.js";
import { resultHeading, resultSections } from "./result-section-specs.js";

export function renderAnalysisResult(container: HTMLElement, result: AnalysisResult): void {
  const previousRequest = container.dataset.requestId;
  const current =
    result.type === "explain-sentence" && (!previousRequest || previousRequest === result.requestId)
      ? container.querySelector<HTMLElement>('[data-result-section="main-structure"]')
      : null;
  for (const child of [...container.childNodes]) {
    if (child !== current) child.remove();
  }
  container.dataset.requestId = result.requestId;
  container.dataset.resultType = result.type;

  const heading = resultHeading(result);
  if (heading !== null) {
    const header = container.ownerDocument.createElement("header");
    header.className = "result-heading";
    const label = container.ownerDocument.createElement("p");
    label.textContent = result.selectionKind === "word" ? "词条" : "短语";
    const title = container.ownerDocument.createElement("h2");
    title.dataset.resultHeading = "";
    title.textContent = heading;
    header.append(label, title);
    container.append(header);
  }

  for (const section of resultSections(result)) {
    const rendered = renderResultSection(container.ownerDocument, section);
    if (section[1] === "main-structure" && current) {
      if (!reconcileMainStructure(current, rendered)) current.replaceWith(rendered);
    } else container.append(rendered);
  }
}
