import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShanbaySyncController, isExactShanbayCollectionPage } from "./shanbay-sync-controller.js";

function addButton(text: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = text;
  document.body.append(button);
  return button;
}

function addTextarea(value = ""): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.placeholder = "请输入需要添加的单词，每行一个";
  textarea.value = value;
  document.body.append(textarea);
  return textarea;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Store Shanbay sync controller", () => {
  it("activates on only the documented exact collection route", () => {
    expect(
      isExactShanbayCollectionPage(new URL("https://web.shanbay.com/wordsweb/#/collection")),
    ).toBe(true);
    expect(
      isExactShanbayCollectionPage(
        new URL("https://web.shanbay.com/wordsweb/#/wordsbook/collection"),
      ),
    ).toBe(false);
    expect(
      isExactShanbayCollectionPage(new URL("https://evil.invalid/wordsweb/#/collection")),
    ).toBe(false);
  });

  it("opens the batch dialog and prefills without clicking final submit", async () => {
    const upload = addButton("批量上传");
    const submit = addButton("批量添加");
    const uploadClick = vi.spyOn(upload, "click");
    const submitClick = vi.spyOn(submit, "click");
    const sendMessage = vi.fn(async () => ({
      batch: {
        items: [{ entryId: "investigation", outboxId: "outbox-1" }],
        token: "batch-token",
      },
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/shanbay-batch",
    }));
    const controller = new ShanbaySyncController({
      acceptsUserGesture: () => true,
      document,
      sendMessage,
    });
    await controller.start();
    expect(uploadClick).toHaveBeenCalledOnce();

    const textarea = addTextarea();
    document.body.append(document.createElement("span"));
    await vi.waitFor(() => expect(textarea.value).toBe("investigation"));
    expect(submitClick).not.toHaveBeenCalled();
    controller.stop();
  });

  it("stays inert when site lifecycle stops during a pending batch claim", async () => {
    let finishClaim: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          finishClaim = resolve;
        }),
    );
    const controller = new ShanbaySyncController({ document, sendMessage });
    const starting = controller.start();

    controller.stop();
    const textarea = addTextarea();
    const upload = addButton("批量上传");
    const uploadClick = vi.spyOn(upload, "click");
    finishClaim?.({
      batch: {
        items: [{ entryId: "investigation", outboxId: "outbox-1" }],
        token: "batch-token",
      },
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/shanbay-batch",
    });
    await starting;

    expect(textarea.value).toBe("");
    expect(uploadClick).not.toHaveBeenCalled();
    expect(document.querySelector("[data-huayi-store-shanbay]")).toBeNull();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("does not overwrite user content and validates partial results against current IDs", async () => {
    const textarea = addTextarea("my own words");
    const submit = addButton("批量添加");
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        batch: {
          items: [
            { entryId: "investigation", outboxId: "outbox-1" },
            { entryId: "evidence", outboxId: "outbox-2" },
          ],
          token: "batch-token",
        },
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/shanbay-batch",
      })
      .mockResolvedValueOnce({
        accepted: true,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/shanbay-resolved",
      });
    const controller = new ShanbaySyncController({
      acceptsUserGesture: () => true,
      document,
      sendMessage,
    });
    await controller.start();
    expect(textarea.value).toBe("my own words");
    expect(document.body.textContent).toContain("没有覆盖");

    textarea.value = "investigation\nevidence";
    submit.click();
    textarea.value = "evidence";
    const failure = document.createElement("div");
    failure.setAttribute("role", "alert");
    failure.textContent = "有1个单词未能成功添加";
    document.body.append(failure);

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenLastCalledWith({
        batchToken: "batch-token",
        confirmedOutboxIds: ["outbox-1"],
        failedOutboxIds: ["outbox-2"],
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/shanbay-resolve",
      }),
    );
    controller.stop();
  });

  it("contains rejected promises in a stable visible error boundary", async () => {
    const sendMessage = vi.fn(async () => Promise.reject(new Error("raw transport error")));
    const controller = new ShanbaySyncController({ document, sendMessage });
    await controller.start();
    expect(document.body.textContent).toContain("与扩展后台通信失败");
    expect(document.body.textContent).not.toContain("raw transport error");
    controller.stop();
  });

  it.each([
    ["consent-required", "尚未同意"],
    ["recipient-disabled", "已停用"],
  ] as const)("renders a stable recipient policy error", async (code, message) => {
    const controller = new ShanbaySyncController({
      document,
      sendMessage: vi.fn(async () => ({
        code,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/wordbook-error",
      })),
    });
    await controller.start();
    expect(document.body.textContent).toContain(message);
    expect(document.body.textContent).not.toContain("后台通信失败");
    controller.stop();
  });

  it("ignores a synthetic final-submit click even if the page forges success DOM", async () => {
    const textarea = addTextarea();
    const submit = addButton("批量添加");
    const sendMessage = vi.fn(async () => ({
      batch: {
        items: [{ entryId: "investigation", outboxId: "outbox-1" }],
        token: "batch-token",
      },
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/shanbay-batch",
    }));
    const controller = new ShanbaySyncController({ document, sendMessage });
    await controller.start();
    expect(textarea.value).toBe("investigation");

    submit.click();
    const success = document.createElement("div");
    success.setAttribute("role", "status");
    success.textContent = "添加成功";
    document.body.append(success);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("does not accept stale success feedback after a real current-batch click", async () => {
    const textarea = addTextarea();
    const submit = addButton("批量添加");
    const stale = document.createElement("div");
    stale.setAttribute("role", "status");
    stale.textContent = "添加成功";
    document.body.append(stale);
    const sendMessage = vi.fn(async () => ({
      batch: {
        items: [{ entryId: "investigation", outboxId: "outbox-1" }],
        token: "batch-token",
      },
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/shanbay-batch",
    }));
    const controller = new ShanbaySyncController({
      acceptsUserGesture: () => true,
      document,
      sendMessage,
    });
    await controller.start();
    expect(textarea.value).toBe("investigation");

    submit.click();
    const unrelated = document.createElement("div");
    unrelated.setAttribute("role", "status");
    unrelated.textContent = "页面已刷新";
    document.body.append(unrelated);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});
