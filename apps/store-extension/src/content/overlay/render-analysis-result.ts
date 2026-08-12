import type { AnalysisResult } from "@huayi/store-domain";

import { renderResultSection } from "./render-result-sections.js";
import { resultHeading, resultSections } from "./result-section-specs.js";

export function renderAnalysisResult(container: HTMLElement, result: AnalysisResult): void {
  container.replaceChildren();
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
    container.append(renderResultSection(container.ownerDocument, section));
  }
}
