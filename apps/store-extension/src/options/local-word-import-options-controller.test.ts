import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { LocalWordImportOptionsController } from "./local-word-import-options-controller.js";

const optionsHtml = readFileSync("apps/store-extension/pages/options.html", "utf8");

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing test element: ${selector}`);
  return found;
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

describe("LocalWordImport Options controller", () => {
  it("previews word and context counts, then requires one explicit confirmation", async () => {
    document.documentElement.innerHTML = optionsHtml;
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "empty",
        type: "store/local-word-import-result",
      })
      .mockResolvedValueOnce({
        contextCount: 4,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "preview",
        previewId: "a".repeat(64),
        type: "store/local-word-import-result",
        wordCount: 3,
      })
      .mockResolvedValueOnce({
        contextCount: 4,
        createdContextCount: 3,
        createdWordCount: 2,
        duplicateContextCount: 1,
        existingWordCount: 1,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "completed",
        type: "store/local-word-import-result",
        wordCount: 3,
      });
    const confirmImport = vi.fn(() => true);
    const controller = new LocalWordImportOptionsController({ confirmImport, sendMessage });
    await controller.initialize(true);

    element<HTMLButtonElement>("[data-local-word-import-preview]").click();
    await vi.waitFor(() =>
      expect(element("[data-local-word-import-summary]").textContent).toContain(
        "3 个词条、4 条语境",
      ),
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(confirmImport).not.toHaveBeenCalled();

    element<HTMLButtonElement>("[data-local-word-import-confirm]").click();
    await vi.waitFor(() => expect(confirmImport).toHaveBeenCalledWith(3, 4));
    await vi.waitFor(() =>
      expect(element("[data-local-word-import-status]").textContent).toContain("导入完成"),
    );
    expect(sendMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      previewId: "a".repeat(64),
      type: "store/local-word-import-confirm",
    });
  });

  it("does not confirm or upload after the user cancels", async () => {
    document.documentElement.innerHTML = optionsHtml;
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "empty",
        type: "store/local-word-import-result",
      })
      .mockResolvedValueOnce({
        contextCount: 0,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "preview",
        previewId: "b".repeat(64),
        type: "store/local-word-import-result",
        wordCount: 1,
      });
    const controller = new LocalWordImportOptionsController({
      confirmImport: () => false,
      sendMessage,
    });
    await controller.initialize(true);
    element<HTMLButtonElement>("[data-local-word-import-preview]").click();
    await vi.waitFor(() =>
      expect(element<HTMLButtonElement>("[data-local-word-import-confirm]").disabled).toBe(false),
    );
    element<HTMLButtonElement>("[data-local-word-import-confirm]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
