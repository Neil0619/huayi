import type { AnalysisResult, StoreLexiconSaveRequest } from "@huayi/store-domain";

import { createWordLexiconSaveAction } from "./overlay-lexicon-save.js";
import type { OverlayWordPresence } from "./overlay-word-presence.js";
import { renderAnalysisResult } from "./render-analysis-result.js";

interface CachedResultOptions {
  readonly acceptsUserGesture: (event: Event) => boolean;
  readonly body: HTMLElement;
  readonly headerActions: HTMLElement;
  readonly presence: OverlayWordPresence;
  readonly openWebWorkspace: () => Promise<void>;
  readonly result: AnalysisResult;
  readonly saveWord: (request: StoreLexiconSaveRequest) => Promise<unknown>;
  readonly sentence: string;
}

function canonicalHeadword(result: AnalysisResult): string | null {
  if (result.type === "translate-word") return result.dictionaryForm;
  if (result.type === "explain-word") return result.wordForm.baseForm;
  return null;
}

export function renderCachedResult(options: CachedResultOptions): void {
  renderAnalysisResult(options.body, options.result);
  const headword = canonicalHeadword(options.result);
  const initialPresence = headword === null ? null : options.presence.valueFor(headword);
  const saveAction = createWordLexiconSaveAction({
    acceptsUserGesture: options.acceptsUserGesture,
    container: options.body,
    result: options.result,
    initialPresence,
    onSaved: (savedHeadword) => options.presence.markPresent(savedHeadword),
    send: options.saveWord,
    sentence: options.sentence,
  });
  options.headerActions.querySelector(".lexicon-save")?.remove();
  if (saveAction !== null) options.headerActions.prepend(saveAction);
  if (headword !== null && initialPresence === null) {
    options.presence.query(headword, options.headerActions);
  }

  const cloud = options.body.ownerDocument.createElement("section");
  cloud.className = "cloud-workspace";
  const status = options.body.ownerDocument.createElement("p");
  status.textContent = "整理与收藏在 Web 完成";
  const open = options.body.ownerDocument.createElement("button");
  open.type = "button";
  open.dataset.openWebWorkspace = "";
  open.textContent = "打开 Web 待整理";
  open.addEventListener("click", (event) => {
    if (!options.acceptsUserGesture(event)) return;
    open.disabled = true;
    void options
      .openWebWorkspace()
      .catch(() => {
        const error = options.body.ownerDocument.createElement("p");
        error.className = "error";
        error.setAttribute("role", "alert");
        error.textContent = "暂时无法打开 Web，请稍后重试。";
        cloud.append(error);
      })
      .finally(() => {
        open.disabled = false;
      });
  });
  cloud.append(status, open);
  options.body.append(cloud);
}
