import { afterEach, describe, expect, it } from "vitest";

import type { ContentCommand } from "../shared/extension-messages.js";
import {
  initializeContentScript,
  type ContentRuntime,
  type ContentScriptInstance,
} from "./content-script.js";

class FakeRuntime implements ContentRuntime {
  readonly sent: ContentCommand[] = [];
  private readonly deliveries: Promise<unknown>[] = [];
  private readonly listeners = new Set<(message: unknown) => void>();

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.listeners.delete(listener),
  };

  enqueueDelivery(delivery: Promise<unknown>): void {
    this.deliveries.push(delivery);
  }

  sendMessage(message: ContentCommand): Promise<unknown> {
    this.sent.push(message);
    return this.deliveries.shift() ?? Promise.resolve({ handled: true });
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

function deferred<T>() {
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

const instances: ContentScriptInstance[] = [];

function createInstance(runtime: FakeRuntime): ContentScriptInstance {
  let nextId = 0;
  const instance = initializeContentScript({
    createRequestId: () => `request-${(nextId += 1)}`,
    document,
    getAnchorRect: () => ({
      bottom: 120,
      height: 20,
      left: 80,
      right: 180,
      top: 100,
      width: 100,
    }),
    runtime,
  });
  instances.push(instance);
  return instance;
}

function selectText(text: string): void {
  const element = document.createElement("p");
  element.textContent = text;
  document.body.append(element);
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error("Selection API is unavailable.");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup"));
}

function selectAndTranslate(text: string): void {
  selectText(text);
  document
    .querySelector<HTMLElement>("[data-huayi-overlay-host]")
    ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='translate']")
    ?.click();
}

async function flushAcknowledgements(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.destroy();
  }
  window.getSelection()?.removeAllRanges();
  document.body.textContent = "";
});

describe("content-script analysis acknowledgements", () => {
  it.each(["handled false", "rejected"] as const)(
    "ignores a stale %s acknowledgement after the replacement word check resolves",
    async (completion) => {
      const runtime = new FakeRuntime();
      const firstAcknowledgement = deferred<{ handled: boolean }>();
      runtime.enqueueDelivery(firstAcknowledgement.promise);
      const instance = createInstance(runtime);

      selectAndTranslate("investigation");
      selectAndTranslate("replacement");
      await flushAcknowledgements();
      runtime.emit({
        presence: "present",
        requestId: "request-3",
        schemaVersion: 1,
        type: "word-status",
      });
      const commandsBeforeStaleAcknowledgement = [...runtime.sent];
      expect(instance.controller.state).toMatchObject({
        selection: { selection: "replacement" },
        status: "loading",
        wordbook: { availability: "present" },
      });

      if (completion === "handled false") {
        firstAcknowledgement.resolve({ handled: false });
      } else {
        firstAcknowledgement.reject(new Error("The old delivery failed."));
      }
      await flushAcknowledgements();

      expect(instance.controller.state).toMatchObject({
        selection: { selection: "replacement" },
        status: "loading",
        wordbook: { availability: "present" },
      });
      expect(runtime.sent).toEqual(commandsBeforeStaleAcknowledgement);
      expect(
        runtime.sent.filter((command) => command.type === "CHECK_WORD_IN_EUDIC"),
      ).toMatchObject([{ request: { requestId: "request-3", word: "replacement" } }]);
    },
  );

  it("rejects the current analysis and its unstarted word check when not handled", async () => {
    const runtime = new FakeRuntime();
    const acknowledgement = deferred<{ handled: boolean }>();
    runtime.enqueueDelivery(acknowledgement.promise);
    const instance = createInstance(runtime);
    selectAndTranslate("investigation");

    acknowledgement.resolve({ handled: false });
    await flushAcknowledgements();

    expect(instance.controller.state).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
      selection: { selection: "investigation" },
      status: "error",
      wordbook: { availability: "unknown" },
    });
    expect(runtime.sent.map((command) => command.type)).toEqual(["ANALYZE_SELECTION"]);
  });

  it("preserves a resolved word status when the analysis host request fails", async () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectAndTranslate("investigation");
    await flushAcknowledgements();
    runtime.emit({
      presence: "present",
      requestId: "request-2",
      schemaVersion: 1,
      type: "word-status",
    });

    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "分析失败。", retryable: true },
      requestId: "request-1",
      schemaVersion: 1,
      type: "error",
    });

    expect(instance.controller.state).toMatchObject({
      error: { code: "NETWORK_ERROR" },
      status: "error",
      wordbook: { availability: "present" },
    });
  });

  it.each(["close", "Escape", "new selection"] as const)(
    "cancels a pending word check after an analysis host error on %s",
    async (trigger) => {
      const runtime = new FakeRuntime();
      const instance = createInstance(runtime);
      selectAndTranslate("investigation");
      await flushAcknowledgements();
      runtime.emit({
        error: { code: "NETWORK_ERROR", message: "分析失败。", retryable: true },
        requestId: "request-1",
        schemaVersion: 1,
        type: "error",
      });

      if (trigger === "close") {
        instance.controller.close();
      } else if (trigger === "Escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
      } else {
        selectText("replacement");
      }

      expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([
        { requestId: "request-2", type: "CANCEL_REQUEST" },
      ]);
      const stateAfterCancellation = instance.controller.state;
      if (trigger === "new selection") {
        expect(stateAfterCancellation).toMatchObject({
          selection: { selection: "replacement" },
          status: "actions",
        });
      } else {
        expect(stateAfterCancellation.status).toBe("closed");
      }

      runtime.emit({
        presence: "present",
        requestId: "request-2",
        schemaVersion: 1,
        type: "word-status",
      });
      expect(instance.controller.state).toEqual(stateAfterCancellation);
    },
  );
});
