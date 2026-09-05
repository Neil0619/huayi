import {
  STORE_MESSAGE_VERSION,
  parseStoreStudyCaptureResponse,
  type StoreStudyCaptureRequest,
  type StoreStudyCaptureResponse,
} from "@huayi/store-domain";

import type { StoreSelectionReading } from "../selection/read-selection.js";

const failedResponse: StoreStudyCaptureResponse = {
  messageVersion: STORE_MESSAGE_VERSION,
  outcome: "failed",
  type: "store/study-capture-result",
};

interface OverlayStudyCaptureOptions {
  readonly acceptsUserGesture: (event: Event) => boolean;
  readonly send: (request: StoreStudyCaptureRequest) => Promise<unknown>;
}

export class OverlayStudyCapture {
  #automaticStarted = false;
  #body: HTMLElement | null = null;
  #generation = 0;
  #selection: StoreSelectionReading | null = null;
  #state: StoreStudyCaptureResponse | null = null;

  readonly #options: OverlayStudyCaptureOptions;
  constructor(options: OverlayStudyCaptureOptions) {
    this.#options = options;
  }

  reset(): void {
    this.#generation += 1;
    this.#automaticStarted = false;
    this.#body = null;
    this.#selection = null;
    this.#state = null;
  }

  startAutomatic(selection: StoreSelectionReading): void {
    this.#selection = selection;
    if (
      this.#automaticStarted ||
      (selection.selectionKind !== "sentence" && selection.selectionKind !== "passage")
    ) {
      return;
    }
    this.#automaticStarted = true;
    void this.#create("automatic");
  }

  render(body: HTMLElement, selection: StoreSelectionReading): void {
    this.#body = body;
    this.#selection = selection;
    body.querySelector(".study-capture")?.remove();
    if (selection.selectionKind === "word") return;
    const section = body.ownerDocument.createElement("section");
    section.className = "study-capture";
    section.setAttribute("aria-live", "polite");
    const status = body.ownerDocument.createElement("p");
    const action = body.ownerDocument.createElement("button");
    action.type = "button";
    const outcome = this.#state?.outcome;
    if (outcome === "created" || outcome === "queued") {
      status.textContent = outcome === "created" ? "已加入收集箱" : "待联网加入";
      action.textContent = "撤销加入";
      action.dataset.studyCaptureUndo = "";
      action.addEventListener("click", (event) => {
        if (this.#options.acceptsUserGesture(event)) void this.#undo();
      });
    } else if (outcome === "existing" || outcome === "linked-analysis") {
      status.textContent = "已在 Web 中";
      action.hidden = true;
    } else if (outcome === "unavailable") {
      status.textContent = "登录后可加入收集箱";
      action.hidden = true;
    } else {
      status.textContent = outcome === "failed" ? "加入失败，可重试" : "保存原句，稍后到收集箱分析";
      action.textContent = outcome === "failed" ? "重试加入" : "加入收集箱";
      action.dataset.studyCaptureCreate = "";
      action.addEventListener("click", (event) => {
        if (this.#options.acceptsUserGesture(event)) void this.#create("manual");
      });
    }
    section.append(status, action);
    body.append(section);
  }

  async #create(trigger: "automatic" | "manual"): Promise<void> {
    const selection = this.#selection;
    if (selection === null || selection.selectionKind === "word") return;
    const generation = this.#generation;
    try {
      const response = parseStoreStudyCaptureResponse(
        await this.#options.send({
          kind: selection.selectionKind,
          messageVersion: STORE_MESSAGE_VERSION,
          sourceText: selection.selection,
          trigger,
          type: "store/study-capture-create",
        }),
      );
      if (generation !== this.#generation) return;
      this.#state = response.outcome === "skipped" ? null : response;
    } catch {
      if (generation !== this.#generation) return;
      this.#state = failedResponse;
    }
    if (this.#body !== null && this.#selection !== null) this.render(this.#body, this.#selection);
  }

  async #undo(): Promise<void> {
    const current = this.#state;
    if (current?.outcome !== "created" && current?.outcome !== "queued") return;
    const generation = this.#generation;
    const request: StoreStudyCaptureRequest =
      current.outcome === "created"
        ? {
            captureId: current.captureId,
            expectedRevision: current.expectedRevision,
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/study-capture-undo-remote",
          }
        : {
            localQueueId: current.localQueueId,
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/study-capture-undo-local",
          };
    try {
      const response = parseStoreStudyCaptureResponse(await this.#options.send(request));
      if (generation !== this.#generation) return;
      this.#state = response.outcome === "undone" ? null : failedResponse;
    } catch {
      if (generation !== this.#generation) return;
      this.#state = failedResponse;
    }
    if (this.#body !== null && this.#selection !== null) this.render(this.#body, this.#selection);
  }
}
