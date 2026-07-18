import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";
import { previewSections, resultSections } from "./analysis-section-specs.js";
import type {
  ContextSectionSpec,
  EntrySectionSpec,
  ListSectionSpec,
  PronunciationSectionSpec,
  RenderableSectionSpec,
  SectionEntry,
  SectionSpec,
} from "./analysis-section-types.js";

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

function patchSource(
  content: HTMLElement,
  value: string,
  wordResult: boolean,
  pronunciation: PronunciationSectionSpec | undefined,
  final: boolean,
): HTMLElement {
  let source = content.querySelector<HTMLElement>(':scope > [data-huayi-section="source"]');
  if (source === null) {
    source = content.ownerDocument.createElement("header");
    source.dataset.huayiSection = "source";
    content.prepend(source);
  }
  source.className = wordResult ? "huayi-lexeme-header" : "huayi-selection-header";
  let copy = source.querySelector<HTMLElement>(":scope > .huayi-source");
  if (copy === null) {
    copy = content.ownerDocument.createElement("p");
    copy.className = "huayi-source";
    copy.dataset.huayiValue = "";
    source.prepend(copy);
  }
  if (copy.textContent !== value) {
    copy.textContent = value;
  }
  let pronunciationElement = source.querySelector<HTMLElement>(
    ':scope > [data-huayi-section="pronunciation"]',
  );
  const pronunciationValue = pronunciation?.value;
  if (wordResult && (pronunciationValue?.length ?? 0) > 0) {
    if (pronunciationElement === null) {
      pronunciationElement = content.ownerDocument.createElement("p");
      pronunciationElement.className = "huayi-pronunciation";
      pronunciationElement.dataset.huayiSection = "pronunciation";
      pronunciationElement.dataset.huayiValue = "";
      source.append(pronunciationElement);
    }
    if (pronunciationElement.textContent !== pronunciationValue) {
      pronunciationElement.textContent = pronunciationValue ?? "";
    }
  } else if (final || !wordResult) {
    pronunciationElement?.remove();
  }
  return source;
}

function sectionClassName(spec: RenderableSectionSpec): string {
  if (spec.kind === "context") return "huayi-section huayi-context-section";
  if (spec.kind === "entries") {
    return `huayi-section huayi-entry-section huayi-entry-section--${spec.layout}`;
  }
  return "huayi-section";
}

function ensureSection(content: HTMLElement, spec: RenderableSectionSpec): HTMLElement {
  let section = content.querySelector<HTMLElement>(`:scope > [data-huayi-section="${spec.key}"]`);
  if (section !== null) {
    return section;
  }
  section = content.ownerDocument.createElement("section");
  section.className = sectionClassName(spec);
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

function patchContextSection(section: HTMLElement, spec: ContextSectionSpec): void {
  const heading = section.querySelector<HTMLElement>(":scope > .huayi-section-title");
  let badge = section.querySelector<HTMLElement>(":scope > .huayi-pos-badge");
  if ((spec.badge?.length ?? 0) > 0) {
    if (badge === null) {
      badge = section.ownerDocument.createElement("span");
      badge.className = "huayi-pos-badge";
      heading?.after(badge);
    }
    if (badge.textContent !== spec.badge) {
      badge.textContent = spec.badge ?? "";
    }
  } else {
    badge?.remove();
  }
  patchTextSection(section, spec.value ?? "");
}

function patchOptionalEntryText(
  item: HTMLElement,
  selector: string,
  className: string,
  value: string | undefined,
  before: Element | null = null,
): void {
  let element = item.querySelector<HTMLElement>(`:scope > ${selector}`);
  if (value === undefined || value.length === 0) {
    element?.remove();
    return;
  }
  if (element === null) {
    element = item.ownerDocument.createElement("span");
    element.className = className;
    item.insertBefore(element, before);
  }
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function patchEntry(item: HTMLElement, value: SectionEntry): void {
  patchOptionalEntryText(item, ".huayi-pos-badge", "huayi-pos-badge", value.badge);
  const detail = item.querySelector(":scope > .huayi-entry-detail");
  patchOptionalEntryText(
    item,
    ".huayi-entry-primary",
    "huayi-entry-primary",
    value.primary,
    detail,
  );
  patchOptionalEntryText(
    item,
    ".huayi-entry-secondary",
    "huayi-entry-secondary",
    value.secondary,
    detail,
  );
  patchOptionalEntryText(item, ".huayi-entry-detail", "huayi-entry-detail", value.detail);
}

function patchEntrySection(section: HTMLElement, spec: EntrySectionSpec, final: boolean): void {
  let listElement = section.querySelector<HTMLElement>(":scope > ul");
  if (listElement === null) {
    listElement = section.ownerDocument.createElement("ul");
    section.append(listElement);
  }
  listElement.className = `huayi-entry-list huayi-entry-list--${spec.layout}`;
  const values = spec.values ?? [];
  values.forEach((value, index) => {
    let item = listElement?.children.item(index) as HTMLLIElement | null;
    if (item === null) {
      item = section.ownerDocument.createElement("li");
      item.className = "huayi-entry";
      item.dataset.huayiItem = String(index);
      listElement?.append(item);
      markEntering(item);
    }
    patchEntry(item, value);
  });
  if (final) {
    while (listElement.children.length > values.length) {
      listElement.lastElementChild?.remove();
    }
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
  const populated = specs.filter((spec): spec is RenderableSectionSpec => {
    if (spec.kind === "pronunciation") return false;
    if (spec.kind === "text" || spec.kind === "context") return (spec.value?.length ?? 0) > 0;
    return (spec.values?.length ?? 0) > 0;
  });
  const sectionElements = populated.map((spec) => {
    const section = ensureSection(content, spec);
    if (spec.kind === "text") {
      patchTextSection(section, spec.value ?? "");
    } else if (spec.kind === "context") {
      patchContextSection(section, spec);
    } else if (spec.kind === "entries") {
      patchEntrySection(section, spec, final);
    } else if (spec.kind === "list") {
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
  const wordResult = state.selection.selectionKind === "word";
  content.classList.toggle("huayi-word-result", wordResult);
  const sourceText =
    state.status === "result" && state.result.type === "translate-word"
      ? state.result.dictionaryForm.toLocaleLowerCase() ===
        state.result.sourceText.toLocaleLowerCase()
        ? state.result.sourceText
        : `${state.result.sourceText} · ${state.result.dictionaryForm}`
      : state.status === "result"
        ? state.result.sourceText
        : state.selection.selection;
  const specs =
    state.status === "result"
      ? resultSections(state.result)
      : state.status === "streaming" || state.status === "error"
        ? previewSections(state)
        : [];
  const pronunciation = specs.find(
    (spec): spec is PronunciationSectionSpec => spec.kind === "pronunciation",
  );
  patchSource(content, sourceText, wordResult, pronunciation, state.status === "result");
  if (state.status === "streaming" && state.preview.lastSequence < 0) {
    renderWaiting(content, waitingMessage);
    return;
  }
  content.querySelector(":scope > .huayi-loading")?.remove();
  patchSections(content, specs, state.status === "result");
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
