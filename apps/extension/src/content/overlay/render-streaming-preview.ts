import type { AnalysisDeltaSection } from "@huayi/protocol";

import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";

const previewTitles: Record<AnalysisDeltaSection, string> = {
  "context-role": "语境作用",
  "contextual-meaning": "语境义",
  "main-structure": "句子主干",
  translation: "译文",
};

const previewSectionOrder: AnalysisDeltaSection[] = [
  "contextual-meaning",
  "translation",
  "main-structure",
  "context-role",
];

function createWaiting(state: StreamingOverlayState | ErrorOverlayState): HTMLElement {
  const loading = document.createElement("div");
  loading.className = "huayi-loading";

  const spinner = document.createElement("span");
  spinner.className = "huayi-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const message = document.createElement("p");
  message.className = "huayi-copy";
  message.textContent = state.action === "translate" ? "正在翻译…" : "正在解释…";
  loading.append(spinner, message);
  return loading;
}

function createPreviewSection(title: string, value: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "huayi-section";

  const heading = document.createElement("h3");
  heading.className = "huayi-section-title";
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.className = "huayi-copy";
  copy.textContent = value;
  section.append(heading, copy);
  return section;
}

export function renderStreamingPreview(
  state: StreamingOverlayState | ErrorOverlayState,
): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "huayi-preview";

  const source = document.createElement("p");
  source.className = "huayi-source";
  source.textContent = state.selection.selection;
  preview.append(source);

  if (state.preview.lastSequence < 0) {
    preview.append(createWaiting(state));
  } else {
    for (const sectionName of previewSectionOrder) {
      const value = state.preview.sections[sectionName];
      if (value !== undefined) {
        preview.append(createPreviewSection(previewTitles[sectionName], value));
      }
    }
  }

  if (state.status === "error" && state.preview.lastSequence >= 0) {
    const incomplete = document.createElement("p");
    incomplete.className = "huayi-preview-incomplete";
    incomplete.textContent = "内容未完整生成";
    preview.append(incomplete);
  }

  return preview;
}
