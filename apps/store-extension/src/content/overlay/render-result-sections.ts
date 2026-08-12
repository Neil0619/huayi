import type { ResultEntry, ResultSection } from "./result-section-specs.js";

function appendBadge(container: HTMLElement, value: string | undefined): void {
  if (value === undefined) return;
  const badge = container.ownerDocument.createElement("span");
  badge.className = "result-badge";
  badge.textContent = value;
  container.append(badge);
}

function entryNode(document: Document, entry: ResultEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "result-entry";
  const lead = document.createElement("div");
  lead.className = "result-entry-lead";
  appendBadge(lead, entry[2]);
  const primary = document.createElement("strong");
  primary.textContent = entry[0];
  lead.append(primary);
  item.append(lead);
  if (entry[1] !== undefined) {
    const secondary = document.createElement("p");
    secondary.textContent = entry[1];
    item.append(secondary);
  }
  if (entry[3] !== undefined) {
    const detail = document.createElement("p");
    detail.className = "result-entry-detail";
    detail.textContent = entry[3];
    item.append(detail);
  }
  return item;
}

export function renderResultSection(document: Document, spec: ResultSection): HTMLElement {
  const section = document.createElement("section");
  section.className = spec[0] === "callout" ? "result-section result-callout" : "result-section";
  section.dataset.resultSection = spec[1];
  if (spec[0] === "callout") section.dataset.resultCallout = "";
  const heading = document.createElement("h3");
  heading.textContent = spec[2];
  section.append(heading);

  if (spec[0] === "text" || spec[0] === "callout") {
    const value = document.createElement("p");
    if (spec[0] === "callout") appendBadge(value, spec[4]);
    const text = document.createElement("span");
    text.textContent = spec[3];
    value.append(text);
    section.append(value);
    return section;
  }

  const list = document.createElement("ul");
  if (spec[0] === "entries") {
    list.dataset.resultLayout = spec[3];
    for (const entry of spec[4]) list.append(entryNode(document, entry));
  } else {
    list.dataset.resultLayout = "list";
    for (const value of spec[3]) {
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
    }
  }
  section.append(list);
  return section;
}
