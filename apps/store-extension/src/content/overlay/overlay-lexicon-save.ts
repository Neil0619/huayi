import {
  STORE_MESSAGE_VERSION,
  type AnalysisResult,
  type StoreLexiconSaveRequest,
  type StoreLexiconResponse,
} from "@huayi/store-domain";

const MAX_CONTEXTUAL_MEANING_LENGTH = 1_000;

function parseResponse(value: unknown): StoreLexiconResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid lexicon response.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.messageVersion !== STORE_MESSAGE_VERSION || typeof record.type !== "string") {
    throw new TypeError("Invalid lexicon response.");
  }
  if (
    record.type === "store/lexicon-save-result" &&
    keys.length === 3 &&
    keys.every((key) => ["messageVersion", "status", "type"].includes(key)) &&
    (record.status === "saved" || record.status === "duplicate")
  ) {
    return {
      messageVersion: STORE_MESSAGE_VERSION,
      status: record.status,
      type: "store/lexicon-save-result",
    };
  }
  if (
    record.type === "store/lexicon-error" &&
    keys.length === 3 &&
    keys.every((key) => ["code", "messageVersion", "type"].includes(key)) &&
    (record.code === "data-corrupt" ||
      record.code === "internal-error" ||
      record.code === "invalid-request")
  ) {
    return {
      code: record.code,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/lexicon-error",
    };
  }
  throw new TypeError("Invalid lexicon response.");
}

export interface WordLexiconSaveOptions {
  readonly acceptsUserGesture: (event: Event) => boolean;
  readonly container: HTMLElement;
  readonly result: AnalysisResult;
  readonly initialPresence?: boolean | null;
  readonly onSaved?: (headword: string) => void;
  readonly send: (request: StoreLexiconSaveRequest) => Promise<unknown>;
  readonly sentence: string;
}

function setPresence(button: HTMLButtonElement, present: boolean | null): void {
  if (present === null) {
    button.dataset.saveState = "checking";
    button.disabled = true;
    button.setAttribute("aria-label", "正在检查本地生词本");
    return;
  }
  button.disabled = present;
  button.dataset.saveState = present ? "saved" : "available";
  button.setAttribute("aria-label", present ? "已加入本地生词本" : "加入本地生词本");
  button.lastChild?.remove();
  button.append(present ? "已保存" : "生词");
}

export function updateWordLexiconPresence(container: ParentNode, present: boolean): void {
  const button = container.querySelector<HTMLButtonElement>("[data-save-word]");
  if (button === null || button.dataset.saveState !== "checking") return;
  setPresence(button, present);
}

function wordbookIcon(document: Document): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.classList.add("lexicon-save-icon");
  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "1.5",
    viewBox: "0 0 20 20",
  })) {
    icon.setAttribute(name, value);
  }
  for (const value of ["M5.75 3.25h8.5v13l-4.25-2.7-4.25 2.7v-13Z", "M10 6.25v4.5M7.75 8.5h4.5"]) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", value);
    icon.append(path);
  }
  return icon;
}

function wordFields(result: AnalysisResult): { headword: string; meaning: string } | null {
  if (result.type === "translate-word") {
    return { headword: result.dictionaryForm, meaning: result.contextualSense.meaningZh };
  }
  if (result.type === "explain-word") {
    return { headword: result.wordForm.baseForm, meaning: result.contextualAnalysisZh };
  }
  return null;
}

function messageForError(code: string): string {
  if (code === "data-corrupt") return "本地生词数据可能已损坏，请清除扩展数据后重试。";
  return "保存失败，请稍后重试。";
}

export function createWordLexiconCheckingAction(document: Document): HTMLElement {
  const section = document.createElement("section");
  section.className = "lexicon-save";
  const button = document.createElement("button");
  button.className = "lexicon-save-button";
  button.dataset.saveState = "checking";
  button.dataset.saveWord = "";
  button.disabled = true;
  button.type = "button";
  button.setAttribute("aria-label", "正在准备本地生词操作");
  button.append(wordbookIcon(document), "生词");
  section.append(button);
  return section;
}

export function createWordLexiconSaveAction(options: WordLexiconSaveOptions): HTMLElement | null {
  const fields = wordFields(options.result);
  if (fields === null) return null;
  const document = options.container.ownerDocument;
  const section = document.createElement("section");
  section.className = "lexicon-save";
  const button = document.createElement("button");
  button.className = "lexicon-save-button";
  button.dataset.saveWord = "";
  button.type = "button";
  button.append(wordbookIcon(document), "生词");
  setPresence(button, options.initialPresence ?? false);
  const status = document.createElement("p");
  status.dataset.saveStatus = "";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("role", "status");
  button.onclick = (event) => {
    if (!options.acceptsUserGesture(event) || button.disabled) return;
    button.disabled = true;
    button.dataset.saveState = "saving";
    button.setAttribute("aria-busy", "true");
    button.lastChild?.remove();
    button.append("添加中");
    status.textContent = "正在保存…";
    const fail = (message: string): void => {
      button.disabled = false;
      button.dataset.saveState = "error";
      button.removeAttribute("aria-busy");
      button.lastChild?.remove();
      button.append("生词");
      status.textContent = message;
    };
    const request: StoreLexiconSaveRequest = {
      contextualMeaningZh: fields.meaning.slice(0, MAX_CONTEXTUAL_MEANING_LENGTH),
      headword: fields.headword,
      messageVersion: STORE_MESSAGE_VERSION,
      sentence: options.sentence,
      type: "store/lexicon-save",
    };
    void options
      .send(request)
      .then((raw) => {
        const response = parseResponse(raw);
        if (response.type === "store/lexicon-save-result") {
          options.onSaved?.(fields.headword);
          button.dataset.saveState = response.status === "saved" ? "saved" : "duplicate";
          button.removeAttribute("aria-busy");
          button.lastChild?.remove();
          button.append("已保存");
          button.setAttribute("aria-label", "已加入本地生词本");
          status.textContent =
            response.status === "saved" ? "已保存到本地生词本。" : "这个语境已经保存过。";
          return;
        }
        fail(
          response.type === "store/lexicon-error"
            ? messageForError(response.code)
            : "保存失败，请稍后重试。",
        );
      })
      .catch(() => {
        fail("保存失败，请稍后重试。");
      });
  };
  section.append(button, status);
  return section;
}

export function appendWordLexiconSaveAction(options: WordLexiconSaveOptions): void {
  const action = createWordLexiconSaveAction(options);
  if (action !== null) options.container.append(action);
}
