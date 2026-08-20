import { describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { handleLocalWordImportMessage } from "./local-word-import-handler.js";

const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
const sender = { id: runtimeId, url: `chrome-extension://${runtimeId}/options.html` };

describe("local word import privileged handler", () => {
  it("accepts only the exact Options sender and strict commands", async () => {
    const importer = {
      confirm: vi.fn(),
      preview: vi.fn(async () => ({
        contextCount: 2,
        messageVersion: STORE_MESSAGE_VERSION as 4,
        outcome: "preview" as const,
        previewId: "a".repeat(64),
        type: "store/local-word-import-result" as const,
        wordCount: 1,
      })),
      processOne: vi.fn(),
      status: vi.fn(),
    };
    await expect(
      handleLocalWordImportMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/local-word-import-preview" },
        { importer, runtimeId, scheduleRetry: vi.fn(), sender },
      ),
    ).resolves.toMatchObject({ outcome: "preview", wordCount: 1 });
    await expect(
      handleLocalWordImportMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/local-word-import-preview" },
        {
          importer,
          runtimeId,
          scheduleRetry: vi.fn(),
          sender: { ...sender, url: `${sender.url}?x=1` },
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleLocalWordImportMessage(
        {
          messageVersion: STORE_MESSAGE_VERSION,
          sourceText: "forged",
          type: "store/local-word-import-preview",
        },
        { importer, runtimeId, scheduleRetry: vi.fn(), sender },
      ),
    ).resolves.toBeUndefined();
  });

  it("confirms by preview id and schedules only pending work", async () => {
    const scheduleRetry = vi.fn();
    const importer = {
      confirm: vi.fn(async () => ({
        pending: true,
        response: {
          contextCount: 2,
          messageVersion: STORE_MESSAGE_VERSION as 4,
          outcome: "progress" as const,
          processedContextCount: 1,
          processedWordCount: 1,
          type: "store/local-word-import-result" as const,
          wordCount: 2,
        },
      })),
      preview: vi.fn(),
      processOne: vi.fn(),
      status: vi.fn(),
    };
    await expect(
      handleLocalWordImportMessage(
        {
          messageVersion: STORE_MESSAGE_VERSION,
          previewId: "a".repeat(64),
          type: "store/local-word-import-confirm",
        },
        { importer, runtimeId, scheduleRetry, sender },
      ),
    ).resolves.toMatchObject({ outcome: "progress" });
    expect(scheduleRetry).toHaveBeenCalledOnce();
  });
});
