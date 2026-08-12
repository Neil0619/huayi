import { vi } from "vitest";

import { STORE_MESSAGE_VERSION, type StoreAnalysisServerMessage } from "@huayi/store-domain";

import type { StoreSelectionReading } from "../selection/read-selection.js";
import {
  StoreOverlayController,
  type ContentAnalysisPort,
  type StoreOverlayRuntime,
} from "./store-overlay-controller.js";

export class FakePort implements ContentAnalysisPort {
  readonly disconnect = vi.fn(() => this.disconnectListener?.());
  readonly postMessage = vi.fn();
  private disconnectListener: (() => void) | undefined;
  private messageListener: ((message: unknown) => void) | undefined;
  readonly onDisconnect = {
    addListener: (listener: () => void) => (this.disconnectListener = listener),
  };
  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => (this.messageListener = listener),
  };

  receive(message: StoreAnalysisServerMessage | unknown): void {
    this.messageListener?.(message);
  }

  drop(): void {
    this.disconnectListener?.();
  }
}

export function reading(
  selection: string,
  selectionKind: StoreSelectionReading["selectionKind"],
): StoreSelectionReading {
  return {
    context: `Context for ${selection}`,
    range: document.createRange(),
    selection,
    selectionKind,
    sentenceContext: selectionKind === "sentence" ? null : `Sentence with ${selection}.`,
  };
}

export function setup(acceptUntrustedEvents = true): {
  readonly controller: StoreOverlayController;
  readonly openOptions: ReturnType<typeof vi.fn>;
  readonly ports: FakePort[];
  readonly queryWordPresence: ReturnType<typeof vi.fn>;
} {
  const ports: FakePort[] = [];
  const openOptions = vi.fn(async () => undefined);
  const queryWordPresence = vi.fn(async () => ({
    messageVersion: STORE_MESSAGE_VERSION,
    present: false,
    type: "store/lexicon-presence-result",
  }));
  const runtime: StoreOverlayRuntime = {
    connectAnalysis: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    openOptions,
    overlayStylesheetUrl: () => "chrome-extension://test/overlay.css",
    queryWordPresence,
    saveWord: vi.fn(async () => ({
      messageVersion: STORE_MESSAGE_VERSION,
      status: "saved",
      type: "store/lexicon-save-result",
    })),
  };
  return {
    controller: new StoreOverlayController(
      document,
      runtime,
      acceptUntrustedEvents ? () => true : undefined,
    ),
    openOptions,
    ports,
    queryWordPresence,
  };
}

export function shadow(): ShadowRoot {
  const root = document.querySelector<HTMLElement>("[data-huayi-store-overlay]")?.shadowRoot;
  if (root === null || root === undefined) throw new Error("Missing Store overlay.");
  return root;
}

export function click(selector: string): void {
  const button = shadow().querySelector<HTMLButtonElement>(selector);
  if (button === null) throw new Error(`Missing button: ${selector}`);
  button.click();
}

export function selectText(element: Element, text: string): Selection {
  const node = element.firstChild;
  if (!(node instanceof Text)) throw new Error("Expected a text fixture.");
  const start = node.data.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const selection = window.getSelection();
  if (selection === null) throw new Error("Selection API is unavailable.");
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}
