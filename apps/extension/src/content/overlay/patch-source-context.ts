import type { SelectionRequestInput } from "../selection/read-selection.js";

function selectedContext(selection: SelectionRequestInput): string {
  const sentenceContext = selection.sentenceContext?.trim();
  if ((sentenceContext?.length ?? 0) > 0) {
    return sentenceContext ?? selection.selection;
  }
  const context = selection.context.trim();
  return context.length > 0 ? context : selection.selection;
}

function selectionIndex(context: string, selection: string): number {
  const exact = context.indexOf(selection);
  return exact >= 0 ? exact : context.toLocaleLowerCase().indexOf(selection.toLocaleLowerCase());
}

function patchHighlightedContext(copy: HTMLElement, context: string, selection: string): void {
  const currentHighlight = copy.querySelector<HTMLElement>(":scope > mark");
  if (copy.textContent === context && currentHighlight?.textContent === selection) {
    return;
  }

  const index = selectionIndex(context, selection);
  if (index < 0 || selection.length === 0) {
    copy.textContent = context;
    return;
  }

  const highlight = copy.ownerDocument.createElement("mark");
  highlight.className = "huayi-context-highlight";
  highlight.textContent = context.slice(index, index + selection.length);
  copy.replaceChildren(
    copy.ownerDocument.createTextNode(context.slice(0, index)),
    highlight,
    copy.ownerDocument.createTextNode(context.slice(index + selection.length)),
  );
}

export function patchSourceContext(
  content: HTMLElement,
  selection: SelectionRequestInput,
): HTMLElement {
  let context = content.querySelector<HTMLElement>(
    ':scope > [data-huayi-section="source-context"]',
  );
  if (context === null) {
    context = content.ownerDocument.createElement("aside");
    context.className = "huayi-source-context";
    context.dataset.huayiSection = "source-context";

    const label = content.ownerDocument.createElement("span");
    label.className = "huayi-context-label";
    label.textContent = "原句语境";
    const copy = content.ownerDocument.createElement("p");
    copy.className = "huayi-source-context-copy";
    context.append(label, copy);
  }

  const copy = context.querySelector<HTMLElement>(":scope > .huayi-source-context-copy");
  if (copy !== null) {
    patchHighlightedContext(copy, selectedContext(selection), selection.selection);
  }
  const source = content.querySelector<HTMLElement>(':scope > [data-huayi-section="source"]');
  if (source?.nextElementSibling !== context) {
    source?.after(context);
  }
  return context;
}
