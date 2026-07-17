import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";
import {
  previewSections,
  resultSections,
  type ListSectionSpec,
  type SectionSpec,
} from "./analysis-section-specs.js";

export type AnalysisPanelState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;

function markEntering(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;
  if (view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) {
    return;
  }
  element.classList.add("huayi-enter");
  const finish = (event: AnimationEvent): void => {
    if (event.target === element) {
      element.classList.remove("huayi-enter");
      element.removeEventListener("animationend", finish);
    }
  };
  element.addEventListener("animationend", finish);
}

function ensurePreview(body: HTMLElement): HTMLElement {
  const existing = body.querySelector<HTMLElement>(":scope > .huayi-analysis-content");
  if (existing !== null) {
    return existing;
  }
  const preview = body.ownerDocument.createElement("div");
  preview.className = "huayi-analysis-content huayi-preview";
  body.prepend(preview);
  return preview;
}

function patchSource(content: HTMLElement, value: string): HTMLElement {
  let source = content.querySelector<HTMLElement>(':scope > [data-huayi-section="source"]');
  if (source === null) {
    source = content.ownerDocument.createElement("p");
    source.className = "huayi-source";
    source.dataset.huayiSection = "source";
    source.dataset.huayiValue = "";
    content.prepend(source);
  }
  if (source.textContent !== value) {
    source.textContent = value;
  }
  return source;
}

function ensureSection(content: HTMLElement, spec: SectionSpec): HTMLElement {
  let section = content.querySelector<HTMLElement>(`:scope > [data-huayi-section="${spec.key}"]`);
  if (section !== null) {
    return section;
  }
  section = content.ownerDocument.createElement("section");
  section.className = "huayi-section";
  section.dataset.huayiSection = spec.key;
  const heading = content.ownerDocument.createElement("h3");
  heading.className = "huayi-section-title";
  heading.textContent = spec.title;
  section.append(heading);
  markEntering(section);
  return section;
}

function patchTextSection(section: HTMLElement, value: string): void {
  let copy = section.querySelector<HTMLElement>(":scope > [data-huayi-value]");
  if (copy === null) {
    copy = section.ownerDocument.createElement("p");
    copy.className = "huayi-copy";
    copy.dataset.huayiValue = "";
    section.append(copy);
  }
  if (copy.textContent !== value) {
    copy.textContent = value;
  }
}

function patchListSection(section: HTMLElement, spec: ListSectionSpec, final: boolean): void {
  let listElement = section.querySelector<HTMLElement>(":scope > ul");
  if (listElement === null) {
    listElement = section.ownerDocument.createElement("ul");
    listElement.className = spec.termList ? "huayi-term-list" : "huayi-list";
    section.append(listElement);
  }
  const values = spec.values ?? [];
  values.forEach((value, index) => {
    let item = listElement?.children.item(index) as HTMLLIElement | null;
    if (item === null) {
      item = section.ownerDocument.createElement("li");
      item.dataset.huayiItem = String(index);
      if (spec.termList === true) {
        item.className = "huayi-term";
        item.dataset.relatedTerm = "";
      }
      listElement?.append(item);
      markEntering(item);
    }
    if (item.textContent !== value) {
      item.textContent = value;
    }
  });
  if (final) {
    while (listElement.children.length > values.length) {
      listElement.lastElementChild?.remove();
    }
  }
}

function patchSections(content: HTMLElement, specs: SectionSpec[], final: boolean): void {
  const populated = specs.filter((spec) =>
    spec.kind === "text" ? (spec.value?.length ?? 0) > 0 : (spec.values?.length ?? 0) > 0,
  );
  const sectionElements = populated.map((spec) => {
    const section = ensureSection(content, spec);
    if (spec.kind === "text") {
      patchTextSection(section, spec.value ?? "");
    } else {
      patchListSection(section, spec, final);
    }
    return section;
  });
  let previous = content.querySelector<HTMLElement>(':scope > [data-huayi-section="source"]');
  sectionElements.forEach((section) => {
    const expected = previous === null ? content.firstElementChild : previous.nextElementSibling;
    if (expected !== section) {
      content.insertBefore(section, expected);
    }
    previous = section;
  });
  if (final) {
    const retained = new Set(["source", ...populated.map((spec) => spec.key)]);
    content.querySelectorAll<HTMLElement>(":scope > [data-huayi-section]").forEach((section) => {
      if (!retained.has(section.dataset.huayiSection ?? "")) {
        section.remove();
      }
    });
  }
}

function renderWaiting(container: HTMLElement, message: string): void {
  let loading = container.querySelector<HTMLElement>(":scope > .huayi-loading");
  if (loading === null) {
    loading = container.ownerDocument.createElement("div");
    loading.className = "huayi-loading";
    const spinner = container.ownerDocument.createElement("span");
    spinner.className = "huayi-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const copy = container.ownerDocument.createElement("p");
    copy.className = "huayi-copy";
    loading.append(spinner, copy);
    container.append(loading);
  }
  const copy = loading.querySelector<HTMLElement>(".huayi-copy");
  if (copy !== null && copy.textContent !== message) {
    copy.textContent = message;
  }
}

export function patchAnalysisBody(body: HTMLElement, state: AnalysisPanelState): void {
  const waitingMessage = state.action === "translate" ? "正在翻译…" : "正在解释…";
  if (state.status === "loading") {
    body.querySelector(":scope > .huayi-analysis-content")?.remove();
    renderWaiting(body, waitingMessage);
    return;
  }
  body.querySelector(":scope > .huayi-loading")?.remove();
  if (state.status === "error" && state.preview.lastSequence < 0) {
    body.querySelector(":scope > .huayi-analysis-content")?.remove();
    return;
  }
  const content = ensurePreview(body);
  content.classList.toggle("huayi-preview", state.status !== "result");
  const sourceText =
    state.status === "result" && state.result.type === "translate-word"
      ? state.result.dictionaryForm.toLocaleLowerCase() ===
        state.result.sourceText.toLocaleLowerCase()
        ? state.result.sourceText
        : `${state.result.sourceText} · ${state.result.dictionaryForm}`
      : state.status === "result"
        ? state.result.sourceText
        : state.selection.selection;
  patchSource(content, sourceText);
  if (state.status === "streaming" && state.preview.lastSequence < 0) {
    renderWaiting(content, waitingMessage);
    return;
  }
  content.querySelector(":scope > .huayi-loading")?.remove();
  patchSections(
    content,
    state.status === "result" ? resultSections(state.result) : previewSections(state),
    state.status === "result",
  );
  let incomplete = content.querySelector<HTMLElement>(":scope > .huayi-preview-incomplete");
  if (state.status === "error") {
    if (incomplete === null) {
      incomplete = content.ownerDocument.createElement("p");
      incomplete.className = "huayi-preview-incomplete";
      incomplete.textContent = "内容未完整生成";
      content.append(incomplete);
    }
  } else {
    incomplete?.remove();
  }
}
