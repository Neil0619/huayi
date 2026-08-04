import { afterEach, describe, expect, it, vi } from "vitest";

import { ShanbaySyncController, isShanbayCollectionPage } from "./shanbay-sync-controller.js";

const controllers: ShanbaySyncController[] = [];

function createDocument(body: string): Document {
  const fixtureDocument = document.implementation.createHTMLDocument("Shanbay fixture");
  fixtureDocument.body.innerHTML = body;
  return fixtureDocument;
}

function batchMessage(words = ["investigation", "state-of-the-art"], batchId = "batch-1") {
  return {
    event: {
      batchId,
      items: words.map((word) => ({
        attempt: "original" as const,
        sourceWords: [word],
        targetWord: word,
      })),
      pendingAfterBatch: 0,
      requestId: "sync-batch-1",
      schemaVersion: 6,
      type: "word-sync-batch",
    },
    type: "SHANBAY_SYNC_BATCH",
  } as const;
}

function resolvedMessage(pendingCount: number, unresolvedCount = 0) {
  return {
    event: {
      batchId: "batch-1",
      pendingCount,
      requestId: "sync-resolved-1",
      resolvedCount: 1,
      retryCount: pendingCount,
      schemaVersion: 6,
      type: "word-sync-batch-resolved",
      unresolved: [],
      unresolvedCount,
    },
    type: "SHANBAY_SYNC_RESOLVED",
  } as const;
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  vi.useRealTimers();
});

describe("ShanbaySyncController", () => {
  it("accepts only the exact Shanbay collection origin and route", () => {
    expect(
      isShanbayCollectionPage({
        hash: "#/collection",
        origin: "https://web.shanbay.com",
        pathname: "/wordsweb/",
      } as Location),
    ).toBe(true);
    expect(
      isShanbayCollectionPage({
        hash: "#/collection",
        origin: "https://web.shanbay.com",
        pathname: "/wordsweb",
      } as Location),
    ).toBe(false);
    expect(
      isShanbayCollectionPage({
        hash: "#/collection",
        origin: "https://web.shanbay.com",
        pathname: "/other/",
      } as Location),
    ).toBe(false);
    expect(
      isShanbayCollectionPage({
        hash: "#/collection-evil",
        origin: "https://web.shanbay.com",
        pathname: "/wordsweb/",
      } as Location),
    ).toBe(false);
  });

  it("opens the batch dialog, prefills exactly once, and never clicks final submit", () => {
    const document = createDocument('<button id="upload">批量上传</button>');
    const upload = document.querySelector<HTMLButtonElement>("#upload");
    upload?.addEventListener("click", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.textContent = "批量添加到生词本";
      const textarea = document.createElement("textarea");
      textarea.placeholder = "在这里输入需要添加的单词";
      const submit = document.createElement("button");
      submit.id = "submit";
      submit.textContent = "批量添加";
      dialog.append(textarea, submit);
      document.body.append(dialog);
    });
    const submitClick = vi.fn();
    document.addEventListener("click", (event) => {
      if ((event.target as Element).id === "submit") submitClick();
    });
    const sendMessage = vi.fn(async () => ({ handled: true }));
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    expect(controller.handleMessage(batchMessage())).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "investigation\nstate-of-the-art",
    );
    expect(submitClick).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ type: "SHANBAY_PAGE_READY" });
  });

  it("supports the current non-button upload control and waits for its async dialog", async () => {
    const document = createDocument(
      '<div id="upload" class="index_button"><span>批量上传</span></div>',
    );
    const submitClick = vi.fn();
    document.querySelector<HTMLElement>("#upload")?.addEventListener("click", () => {
      setTimeout(() => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.textContent = "批量添加到生词本";
        const textarea = document.createElement("textarea");
        textarea.placeholder = "在这里输入需要添加的单词";
        const submit = document.createElement("button");
        submit.textContent = "批量添加";
        submit.addEventListener("click", submitClick);
        dialog.append(textarea, submit);
        document.body.append(dialog);
      }, 0);
    });
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);

    controller.handleMessage(batchMessage());

    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "investigation\nstate-of-the-art",
      ),
    );
    expect(submitClick).not.toHaveBeenCalled();
  });

  it("waits for the upload control when the Shanbay SPA renders it after the batch arrives", async () => {
    const document = createDocument("<main>生词本正在加载</main>");
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);

    controller.handleMessage(batchMessage());

    const upload = document.createElement("div");
    upload.className = "index_button";
    upload.innerHTML = "<span>批量上传</span>";
    upload.addEventListener("click", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.textContent = "批量添加到生词本";
      const textarea = document.createElement("textarea");
      textarea.placeholder = "在这里输入需要添加的单词";
      dialog.append(textarea);
      document.body.append(dialog);
    });
    document.body.append(upload);

    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "investigation\nstate-of-the-art",
      ),
    );
  });

  it("does not overwrite existing user input", () => {
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词">user content</textarea>
      </div>`);
    const controller = new ShanbaySyncController({
      document,
      sendMessage: vi.fn(async () => undefined),
    });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("user content");
  });

  it.each([
    ["登录后使用生词本", "请先登录扇贝", false],
    ["页面已改版", "扇贝页面结构已变化", true],
  ])("preserves the batch for a non-actionable page: %s", (pageText, expectedMessage, wait) => {
    vi.useFakeTimers();
    const document = createDocument(`<main>${pageText}</main>`);
    const controller = new ShanbaySyncController({
      document,
      sendMessage: vi.fn(async () => undefined),
    });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    if (wait) vi.advanceTimersByTime(5_000);
    expect(
      document
        .querySelector<HTMLElement>("[data-huayi-shanbay-sync]")
        ?.shadowRoot?.textContent?.includes(expectedMessage),
    ).toBe(true);
  });

  it("automatically confirms only an explicit all-success message", async () => {
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <button>批量添加</button>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    document.querySelector<HTMLButtonElement>("button")?.click();
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.textContent = "批量添加成功";
    document.body.append(status);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        batchId: "batch-1",
        rejectedTargets: [],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    );
  });

  it("keeps the batch retryable when the resolution command cannot reach the background", async () => {
    const document = createDocument(`
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <button>批量添加</button>
      </div>`);
    let resolutionAttempts = 0;
    const sendMessage = vi.fn(async (message) => {
      if (message.type !== "RESOLVE_SHANBAY_BATCH") return { handled: true };
      resolutionAttempts += 1;
      if (resolutionAttempts === 1) throw new Error("background unavailable");
      return { handled: true };
    });
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    const submit = document.querySelector<HTMLButtonElement>("button");
    submit?.click();
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.textContent = "批量添加成功";
    document.body.append(status);

    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>("[data-huayi-shanbay-sync]")?.shadowRoot?.textContent,
      ).toContain("通信失败"),
    );

    submit?.click();
    status.textContent = "全部单词添加成功";
    await vi.waitFor(() => expect(resolutionAttempts).toBe(2));
  });

  it("ignores a stale success message that was visible before submit", async () => {
    const document = createDocument(`
      <div role="status">上一次批量添加成功</div>
      <div role="dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <button>批量添加</button>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    document.querySelector<HTMLButtonElement>("button")?.click();
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "RESOLVE_SHANBAY_BATCH" }),
    );
  });

  it.each(["部分添加失败", "有 1 个单词未添加"])(
    "does not auto-confirm an inconclusive result: %s",
    async (feedback) => {
      const document = createDocument(`
        <div role="dialog">批量添加到生词本
          <textarea placeholder="在这里输入需要添加的单词"></textarea>
          <button>批量添加</button>
        </div>`);
      const sendMessage = vi.fn(async () => undefined);
      const controller = new ShanbaySyncController({ document, sendMessage });
      controllers.push(controller);
      controller.handleMessage(batchMessage());
      document.querySelector<HTMLButtonElement>("button")?.click();
      const status = document.createElement("div");
      status.setAttribute("role", "alert");
      status.textContent = feedback;
      document.body.append(status);
      await vi.waitFor(() =>
        expect(
          document
            .querySelector<HTMLElement>("[data-huayi-shanbay-sync]")
            ?.shadowRoot?.textContent?.includes("无法验证"),
        ).toBe(true),
      );
      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "RESOLVE_SHANBAY_BATCH" }),
      );
    },
  );

  it("automatically resolves an exact rejected subset after the current submit", async () => {
    const document = createDocument(`
      <div class="batch-dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <input id="submit" type="button" value="批量添加">
        <div class="batch-warning"><span id="failure-message">等待结果</span></div>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector<HTMLInputElement>("#submit")?.click();
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea !== null) textarea.value = "state-of-the-art";
    const failureText = document.querySelector("#failure-message")?.firstChild;
    if (failureText !== null && failureText !== undefined) {
      failureText.nodeValue = "有1个单词未能成功添加";
    }

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        batchId: "batch-1",
        rejectedTargets: ["state-of-the-art"],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    );
  });

  it.each([
    ["normalizes the rejected words", false, "next-word"],
    ["preserves a subsequent user edit", true, "user edit"],
  ])("%s after partial confirmation", async (_scenario, userEdited, expectedValue) => {
    const document = createDocument(`
      <div class="batch-dialog">批量添加到生词本
        <textarea placeholder="在这里输入需要添加的单词"></textarea>
        <input type="button" value="批量添加">
        <span id="failure-message">等待结果</span>
      </div>`);
    const sendMessage = vi.fn(async () => undefined);
    const controller = new ShanbaySyncController({ document, sendMessage });
    controllers.push(controller);
    controller.handleMessage(batchMessage());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    document.querySelector<HTMLInputElement>('input[value="批量添加"]')?.click();
    if (textarea !== null) textarea.value = "state-of-the-art";
    const failureText = document.querySelector("#failure-message")?.firstChild;
    if (failureText !== null && failureText !== undefined) {
      failureText.nodeValue = "有1个单词未能成功添加";
    }
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        batchId: "batch-1",
        rejectedTargets: ["state-of-the-art"],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    );
    if (textarea !== null) {
      textarea.value = userEdited ? "user edit" : "state-of-the-art\n";
      textarea.dispatchEvent(new Event(userEdited ? "beforeinput" : "input", { bubbles: true }));
    }
    controller.handleMessage(resolvedMessage(1));
    controller.handleMessage(batchMessage(["next-word"], "batch-2"));

    expect(textarea?.value).toBe(expectedValue);
  });
});
