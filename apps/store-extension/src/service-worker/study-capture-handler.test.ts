import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleStudyCaptureMessage } from "./study-capture-handler.js";

const request = {
  kind: "sentence" as const,
  messageVersion: STORE_MESSAGE_VERSION,
  sourceText: "This is worth learning.",
  trigger: "automatic" as const,
  type: "store/study-capture-create" as const,
};
const preferences = {
  cloudWordCopyMode: "enabled" as const,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "automatic" as const,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

function setup(overrides: Record<string, unknown> = {}) {
  const outbox = {
    enqueue: vi.fn(async () => ({ localQueueId: "queue-1", status: "queued" as const })),
    process: vi.fn(async () => ({
      pending: false,
      status: "submitted" as const,
      submission: {
        response: {
          capture: {
            captureCount: 1,
            createdAt: "2026-08-13T00:00:00.000Z",
            firstCapturedAt: "2026-08-13T00:00:00.000Z",
            id: "capture-1",
            kind: "sentence" as const,
            lastCapturedAt: "2026-08-13T00:00:00.000Z",
            normalizedTextHash: "a".repeat(64),
            revision: 1,
            sourceText: "This is worth learning.",
            status: "pending" as const,
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
          outcome: "created" as const,
          undo: { captureId: "capture-1", expectedRevision: 1 },
        },
        type: "study-capture" as const,
      },
      submittedId: "queue-1",
    })),
    remove: vi.fn(async () => true),
  };
  const options = {
    api: { undo: vi.fn(async () => ({ deleted: true, id: "capture-1" })) },
    createIdempotencyKey: () => "undo-key",
    outbox,
    preferences: { sync: vi.fn(async () => preferences) },
    runtimeId: "extension-id",
    scheduleRetry: vi.fn(),
    sender: { id: "extension-id", url: "https://example.test/page" },
    sessionVault: {
      readSession: vi.fn(async () => ({
        expiresAt: "2026-09-13T00:00:00.000Z",
        preferences,
        token: "t".repeat(32),
      })),
    },
    ...overrides,
  };
  return { options, outbox };
}

describe("StudyCapture privileged handler", () => {
  it("creates automatic sentence capture and returns only current-card undo proof", async () => {
    const context = setup();
    await expect(handleStudyCaptureMessage(request, context.options as never)).resolves.toEqual({
      captureId: "capture-1",
      expectedRevision: 1,
      messageVersion: STORE_MESSAGE_VERSION,
      outcome: "created",
      type: "store/study-capture-result",
    });
    expect(context.outbox.enqueue).toHaveBeenCalledWith({
      payload: { kind: "sentence", sourceText: "This is worth learning." },
      type: "study-capture",
    });
  });

  it("skips automatic capture for manual accounts and phrases", async () => {
    const manual = setup({
      preferences: {
        sync: vi.fn(async () => ({ ...preferences, studyCaptureMode: "manual" as const })),
      },
    });
    await expect(
      handleStudyCaptureMessage(request, manual.options as never),
    ).resolves.toMatchObject({ outcome: "skipped" });
    expect(manual.outbox.enqueue).not.toHaveBeenCalled();

    const phrase = setup();
    await expect(
      handleStudyCaptureMessage({ ...request, kind: "phrase" }, phrase.options as never),
    ).resolves.toMatchObject({ outcome: "skipped" });
    expect(phrase.outbox.enqueue).not.toHaveBeenCalled();
  });

  it("returns local undo for retryable offline queue and removes only that item", async () => {
    const context = setup({
      outbox: {
        enqueue: vi.fn(async () => ({ localQueueId: "queue-1", status: "queued" })),
        process: vi.fn(async () => ({ pending: true, status: "retry" })),
        remove: vi.fn(async () => true),
      },
    });
    await expect(
      handleStudyCaptureMessage(request, context.options as never),
    ).resolves.toMatchObject({
      localQueueId: "queue-1",
      outcome: "queued",
    });
    await expect(
      handleStudyCaptureMessage(
        {
          localQueueId: "queue-1",
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/study-capture-undo-local",
        },
        context.options as never,
      ),
    ).resolves.toMatchObject({ outcome: "undone" });
  });

  it("rejects popup, cross-extension, and payload-bearing messages", async () => {
    for (const value of [
      setup({ sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" } }),
      setup({ sender: { id: "other", url: "https://example.test" } }),
    ]) {
      await expect(
        handleStudyCaptureMessage(request, value.options as never),
      ).resolves.toBeUndefined();
    }
    const context = setup();
    await expect(
      handleStudyCaptureMessage(
        { ...request, result: { translationZh: "secret" } },
        context.options as never,
      ),
    ).resolves.toBeUndefined();
  });
});
