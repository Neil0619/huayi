import { afterEach, describe, expect, it, vi } from "vitest";

import { ShanbaySyncController } from "./shanbay-sync-controller.js";

const controllers: ShanbaySyncController[] = [];

function createDocument(body: string): Document {
  const fixtureDocument = document.implementation.createHTMLDocument("Shanbay fixture");
  fixtureDocument.body.innerHTML = body;
  return fixtureDocument;
}

function batchMessage() {
  return {
    event: {
      batchId: "batch-1",
      items: [
        {
          attempt: "original" as const,
          sourceWords: ["investigation"],
          targetWord: "investigation",
        },
      ],
      pendingAfterBatch: 0,
      requestId: "sync-batch-1",
      schemaVersion: 7,
      type: "word-sync-batch",
    },
    type: "SHANBAY_SYNC_BATCH",
  } as const;
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  vi.useRealTimers();
});

describe("ShanbaySyncController fallback and unresolved UI", () => {
  it("accepts Shanbay's current full-count completion after the submitted input is cleared", async () => {
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <button id="submit">批量添加</button>
        <div id="result"></div>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    document.querySelector<HTMLButtonElement>("#submit")?.click();
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea !== null) textarea.value = "";
    const result = document.querySelector("#result");
    if (result !== null) result.textContent = "添加完成（1/1）";

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        batchId: "batch-1",
        rejectedTargets: [],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    );
  });

  it("does not accept an old full-count completion while the submitted input remains", async () => {
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <button id="submit">批量添加</button>
        <div>添加完成（1/1）</div>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    document.querySelector<HTMLButtonElement>("#submit")?.click();
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "RESOLVE_SHANBAY_BATCH" }),
    );
  });

  it("offers manual confirmation after ten seconds without a conclusive result", () => {
    vi.useFakeTimers();
    const strictSetTimeout = function (
      this: unknown,
      handler: () => void,
      timeout: number,
    ): number {
      expect(this).toBeUndefined();
      return window.setTimeout(handler, timeout);
    };
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <input id="submit" type="button" value="批量添加">
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({
      document,
      sendMessage,
      setTimeout: strictSetTimeout,
    });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    document.querySelector<HTMLInputElement>("#submit")?.click();
    vi.advanceTimersByTime(10_000);
    const host = document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]");
    const confirm = [...(host?.shadowRoot?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "确认已全部添加",
    );
    expect(confirm).toBeDefined();
    confirm?.click();
    expect(sendMessage).toHaveBeenCalledWith({
      batchId: "batch-1",
      rejectedTargets: [],
      type: "RESOLVE_SHANBAY_BATCH",
    });
  });

  it("keeps the durable batch when the user chooses the manual fallback", () => {
    vi.useFakeTimers();
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <button id="submit">批量添加</button>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    document.querySelector<HTMLButtonElement>("#submit")?.click();
    vi.advanceTimersByTime(10_000);
    const buttons = [
      ...(document
        .querySelector<HTMLElement>("[data-huayi-shanbay-sync]")
        ?.shadowRoot?.querySelectorAll("button") ?? []),
    ];
    buttons.find((button) => button.textContent === "保留待同步")?.click();
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "RESOLVE_SHANBAY_BATCH" }),
    );
  });

  it("shows source-to-lemma mappings without changing the submitted target list", () => {
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
      </div>`);
    const controller = new ShanbaySyncController({
      document,
      sendMessage: vi.fn(async () => undefined),
    });
    controllers.push(controller);
    const message = {
      event: {
        batchId: "batch-lemma",
        items: [
          {
            attempt: "lemma",
            sourceWords: ["orbiting"],
            targetWord: "orbit",
          },
        ],
        pendingAfterBatch: 0,
        requestId: "sync-batch-lemma",
        schemaVersion: 7,
        type: "word-sync-batch",
      },
      type: "SHANBAY_SYNC_BATCH",
    } as const;
    controller.handleMessage(message);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("orbit");
    expect(
      document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot?.textContent,
    ).toContain("orbiting → orbit");
  });

  it("renders persisted unresolved words and requeues only validated manual replacements", () => {
    const document = createDocument("<main>生词本</main>");
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage({
      event: {
        items: [
          {
            candidates: [],
            lastTargetWord: "splendidly",
            reason: "no-lemma",
            sourceWord: "splendidly",
          },
        ],
        offset: 0,
        requestId: "sync-list-1",
        schemaVersion: 7,
        totalCount: 1,
        type: "word-sync-unresolved-list",
      },
      type: "SHANBAY_SYNC_UNRESOLVED",
    });
    const shadow = document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot;
    expect(shadow?.textContent).toContain("splendidly");
    const input = shadow?.querySelector<HTMLInputElement>("input");
    if (input === null || input === undefined) throw new Error("Expected unresolved input.");
    input.value = "splendid";
    [...(shadow?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent === "重新入队")
      ?.click();
    expect(sendMessage).toHaveBeenCalledWith({
      items: [{ sourceWord: "splendidly", targetWord: "splendid" }],
      type: "REQUEUE_SHANBAY_UNRESOLVED",
    });
  });

  it("offers a per-word discard beside the replacement input without removing it optimistically", () => {
    const document = createDocument("<main>生词本</main>");
    const sendMessage = vi.fn(async () => ({ handled: true }));
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage({
      event: {
        items: [
          {
            candidates: [],
            lastTargetWord: "splendidly",
            reason: "no-lemma",
            sourceWord: "splendidly",
          },
          {
            candidates: [],
            lastTargetWord: "msg",
            reason: "no-lemma",
            sourceWord: "msg",
          },
        ],
        offset: 0,
        requestId: "sync-list-discard",
        schemaVersion: 7,
        totalCount: 2,
        type: "word-sync-unresolved-list",
      },
      type: "SHANBAY_SYNC_UNRESOLVED",
    });
    const shadow = document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot;
    const discard = [...(shadow?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "放弃" && button.dataset.sourceWord === "splendidly",
    );

    discard?.click();

    expect(sendMessage).toHaveBeenCalledWith({
      sourceWords: ["splendidly"],
      type: "DISCARD_SHANBAY_UNRESOLVED",
    });
    expect(shadow?.textContent).toContain("splendidly");
    expect(discard?.disabled).toBe(true);
  });

  it("requires a second click before discarding every persisted unresolved word", () => {
    const document = createDocument("<main>生词本</main>");
    const sendMessage = vi.fn(async () => ({ handled: true }));
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage({
      event: {
        items: [
          {
            candidates: [],
            lastTargetWord: "splendidly",
            reason: "no-lemma",
            sourceWord: "splendidly",
          },
        ],
        offset: 0,
        requestId: "sync-list-discard-all",
        schemaVersion: 7,
        totalCount: 11,
        type: "word-sync-unresolved-list",
      },
      type: "SHANBAY_SYNC_UNRESOLVED",
    });
    const shadow = document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot;
    const discardAll = [...(shadow?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "全部放弃（11）",
    );

    discardAll?.click();

    expect(sendMessage).not.toHaveBeenCalledWith({
      type: "DISCARD_ALL_SHANBAY_UNRESOLVED",
    });
    expect(discardAll?.textContent).toBe("确认全部放弃（11）");
    expect(shadow?.textContent).toContain("不会再次自动同步");

    discardAll?.click();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "DISCARD_ALL_SHANBAY_UNRESOLVED",
    });
    expect(discardAll?.disabled).toBe(true);
  });

  it("pages unresolved words within boundaries and keeps actions scoped to the rendered page", () => {
    const document = createDocument("<main>生词本</main>");
    const sendMessage = vi.fn(async () => ({ handled: true }));
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage({
      event: {
        items: Array.from({ length: 100 }, () => ({
          candidates: [],
          lastTargetWord: "firstly",
          reason: "no-lemma" as const,
          sourceWord: "firstly",
        })),
        offset: 0,
        requestId: "sync-list-page-1",
        schemaVersion: 7,
        totalCount: 101,
        type: "word-sync-unresolved-list",
      },
      type: "SHANBAY_SYNC_UNRESOLVED",
    });
    let shadow = document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot;
    [...(shadow?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "下一页")
      ?.click();
    expect(sendMessage).toHaveBeenLastCalledWith({
      offset: 100,
      type: "LIST_SHANBAY_UNRESOLVED",
    });

    controller.handleMessage({
      event: {
        items: [
          {
            candidates: [],
            lastTargetWord: "secondly",
            reason: "no-lemma",
            sourceWord: "secondly",
          },
        ],
        offset: 100,
        requestId: "sync-list-page-2",
        schemaVersion: 7,
        totalCount: 101,
        type: "word-sync-unresolved-list",
      },
      type: "SHANBAY_SYNC_UNRESOLVED",
    });
    shadow = document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot;
    const buttons = [...(shadow?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    buttons.find((button) => button.textContent === "上一页")?.click();
    expect(sendMessage).toHaveBeenLastCalledWith({
      offset: 0,
      type: "LIST_SHANBAY_UNRESOLVED",
    });
    expect(buttons.find((button) => button.textContent === "下一页")).toBeUndefined();

    const input = shadow?.querySelector<HTMLInputElement>("input");
    if (input === null || input === undefined)
      throw new Error("Expected current-page unresolved input.");
    input.value = "second";
    buttons.find((button) => button.textContent === "重新入队")?.click();
    expect(sendMessage).toHaveBeenLastCalledWith({
      items: [{ sourceWord: "secondly", targetWord: "second" }],
      type: "REQUEUE_SHANBAY_UNRESOLVED",
    });
  });
});
