import { afterEach, describe, expect, it, vi } from "vitest";

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
  private readonly warmupDeliveries: Promise<unknown>[] = [];

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.listeners.delete(listener),
  };

  enqueueDelivery(delivery: Promise<unknown>): void {
    this.deliveries.push(delivery);
  }

  enqueueWarmupDelivery(delivery: Promise<unknown>): void {
    this.warmupDeliveries.push(delivery);
  }

  sendMessage(message: ContentCommand): Promise<unknown> {
    this.sent.push(message);
    if (message.type === "WARMUP_HOST") {
      return this.warmupDeliveries.shift() ?? Promise.resolve({ handled: true });
    }
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
  it("shows actions synchronously before sending one page-data-free warmup command", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const show = vi.spyOn(instance.controller, "show");
    const sendMessage = vi.spyOn(runtime, "sendMessage");

    selectText("investigation");

    expect(instance.controller.state.status).toBe("actions");
    expect(runtime.sent).toEqual([{ type: "WARMUP_HOST" }]);
    expect(show).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
    const showOrder = show.mock.invocationCallOrder[0];
    const sendOrder = sendMessage.mock.invocationCallOrder[0];
    if (showOrder === undefined || sendOrder === undefined) {
      throw new Error("Expected recorded show and send invocations.");
    }
    expect(showOrder).toBeLessThan(sendOrder);
  });

  it("starts the check before an early add can replace it while analysis acknowledgement waits", async () => {
    const runtime = new FakeRuntime();
    const analysisAcknowledgement = deferred<{ handled: boolean }>();
    runtime.enqueueDelivery(analysisAcknowledgement.promise);
    const instance = createInstance(runtime);

    selectAndTranslate("investigation");
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='add-word']")
      ?.click();

    expect(runtime.sent).toMatchObject([
      { type: "WARMUP_HOST" },
      { request: { requestId: "request-1" }, type: "ANALYZE_SELECTION" },
      { request: { requestId: "request-2" }, type: "CHECK_WORD_IN_EUDIC" },
      { requestId: "request-2", type: "CANCEL_REQUEST" },
      { request: { requestId: "request-3" }, type: "ADD_WORD_TO_EUDIC" },
    ]);

    analysisAcknowledgement.resolve({ handled: true });
    await flushAcknowledgements();

    expect(runtime.sent.filter((command) => command.type === "CHECK_WORD_IN_EUDIC")).toHaveLength(
      1,
    );
  });

  it("offers an absent word during loading before the analysis result arrives", async () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectAndTranslate("investigation");
    await flushAcknowledgements();

    runtime.emit({
      presence: "absent",
      requestId: "request-2",
      schemaVersion: 7,
      type: "word-status",
    });

    const button = instance.controller.shadowRoot.querySelector<HTMLButtonElement>(
      "[data-action='add-word']",
    );
    expect(instance.controller.state).toMatchObject({
      status: "loading",
      wordbook: { availability: "absent" },
    });
    expect(button?.textContent).toBe("生词");
    expect(button?.disabled).toBe(false);
  });

  it("ignores warmup acknowledgement failure but still surfaces a real analysis error", async () => {
    const runtime = new FakeRuntime();
    const warmupAcknowledgement = deferred<{ handled: boolean }>();
    void warmupAcknowledgement.promise.catch(() => undefined);
    runtime.enqueueWarmupDelivery(warmupAcknowledgement.promise);
    const instance = createInstance(runtime);

    selectText("investigation");
    warmupAcknowledgement.reject(new Error("Warmup transport failed."));
    await flushAcknowledgements();
    expect(instance.controller.state.status).toBe("actions");

    instance.controller.start("translate");
    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "分析失败。", retryable: true },
      requestId: "request-1",
      schemaVersion: 7,
      type: "error",
    });

    expect(instance.controller.state).toMatchObject({
      error: { code: "NETWORK_ERROR" },
      status: "error",
    });
    expect(runtime.sent.map((command) => command.type)).toEqual([
      "WARMUP_HOST",
      "ANALYZE_SELECTION",
      "CHECK_WORD_IN_EUDIC",
    ]);
  });

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
        requestId: "request-4",
        schemaVersion: 7,
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
      ).toMatchObject([
        { request: { requestId: "request-2", word: "investigation" } },
        { request: { requestId: "request-4", word: "replacement" } },
      ]);
    },
  );

  it.each(["handled false", "rejected"] as const)(
    "rejects the current analysis and cancels its started word check when %s",
    async (completion) => {
      const runtime = new FakeRuntime();
      const acknowledgement = deferred<{ handled: boolean }>();
      runtime.enqueueDelivery(acknowledgement.promise);
      const instance = createInstance(runtime);
      selectAndTranslate("investigation");

      if (completion === "handled false") {
        acknowledgement.resolve({ handled: false });
      } else {
        acknowledgement.reject(new Error("The delivery failed."));
      }
      await flushAcknowledgements();

      expect(instance.controller.state).toMatchObject({
        error: { code: "INTERNAL_ERROR" },
        selection: { selection: "investigation" },
        status: "error",
        wordbook: { availability: "unknown" },
      });
      expect(runtime.sent.map((command) => command.type)).toEqual([
        "WARMUP_HOST",
        "ANALYZE_SELECTION",
        "CHECK_WORD_IN_EUDIC",
        "CANCEL_REQUEST",
      ]);
      expect(runtime.sent.at(-1)).toEqual({
        requestId: "request-2",
        type: "CANCEL_REQUEST",
      });
    },
  );

  it("preserves a resolved word status when the analysis host request fails", async () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectAndTranslate("investigation");
    await flushAcknowledgements();
    runtime.emit({
      presence: "present",
      requestId: "request-2",
      schemaVersion: 7,
      type: "word-status",
    });

    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "分析失败。", retryable: true },
      requestId: "request-1",
      schemaVersion: 7,
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
        schemaVersion: 7,
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
        schemaVersion: 7,
        type: "word-status",
      });
      expect(instance.controller.state).toEqual(stateAfterCancellation);
    },
  );
});
