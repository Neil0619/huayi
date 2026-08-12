import {
  STORE_MESSAGE_VERSION,
  normalizeHeadword,
  parseStoreLexiconResponse,
} from "@huayi/store-domain";

import {
  createWordLexiconCheckingAction,
  updateWordLexiconPresence,
} from "./overlay-lexicon-save.js";
import type { StoreOverlayRuntime } from "./overlay-runtime.js";

export class OverlayWordPresence {
  private generation = 0;
  private headword: string | null = null;
  private value: boolean | null = null;

  constructor(private readonly runtime: StoreOverlayRuntime) {}

  reset(): void {
    this.generation += 1;
    this.headword = null;
    this.value = null;
  }

  valueFor(rawHeadword: string): boolean | null {
    try {
      return this.headword === normalizeHeadword(rawHeadword) ? this.value : null;
    } catch {
      return false;
    }
  }

  markPresent(rawHeadword: string): void {
    try {
      this.generation += 1;
      this.headword = normalizeHeadword(rawHeadword);
      this.value = true;
    } catch {
      // A successful save request can only contain a valid normalized headword.
    }
  }

  query(rawHeadword: string, actions: HTMLElement): void {
    let headword: string;
    try {
      headword = normalizeHeadword(rawHeadword);
    } catch {
      return;
    }
    const generation = ++this.generation;
    this.headword = headword;
    this.value = null;
    if (actions.querySelector(".lexicon-save") === null) {
      actions.prepend(createWordLexiconCheckingAction(actions.ownerDocument));
    }
    void this.runtime
      .queryWordPresence({
        headword,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/lexicon-presence",
      })
      .then((raw) => {
        if (generation !== this.generation || this.headword !== headword) return;
        const response = parseStoreLexiconResponse(raw);
        this.value = response.type === "store/lexicon-presence-result" && response.present;
        updateWordLexiconPresence(actions, this.value);
      })
      .catch(() => {
        if (generation !== this.generation || this.headword !== headword) return;
        this.value = false;
        updateWordLexiconPresence(actions, false);
      });
  }
}
