import { describe, expect, it, vi } from "vitest";

import { createCloudWordCopyClient } from "./cloud-word-copy-client.js";

const input = {
  collectedAt: "2026-08-13T00:00:00.000Z",
  contextualMeaningZh: "维持",
  headword: "sustain",
  sentence: "The effort cannot be sustained.",
};
const preferences = {
  cloudWordCopyMode: "enabled" as const,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "manual" as const,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("CloudWordCopy local-first client", () => {
  it("queues only after an enabled account preference and processes the durable item", async () => {
    const outbox = {
      enqueue: vi.fn(async () => ({ localQueueId: "queue-1", status: "queued" as const })),
      process: vi.fn(async () => ({
        pending: false,
        status: "submitted" as const,
        submittedId: "queue-1",
      })),
    };
    const client = createCloudWordCopyClient({
      outbox,
      preferences: { sync: vi.fn(async () => preferences) },
      scheduleRetry: vi.fn(),
    });

    await expect(client.copy(input)).resolves.toBe("submitted");
    expect(outbox.enqueue).toHaveBeenCalledWith({ payload: input, type: "cloud-word-copy" });
  });

  it("does not upload when the account preference is disabled", async () => {
    const outbox = { enqueue: vi.fn(), process: vi.fn() };
    const client = createCloudWordCopyClient({
      outbox: outbox as never,
      preferences: {
        sync: vi.fn(async () => ({ ...preferences, cloudWordCopyMode: "disabled" as const })),
      },
      scheduleRetry: vi.fn(),
    });

    await expect(client.copy(input)).resolves.toBe("disabled");
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("keeps local success independent from retryable cloud processing", async () => {
    const scheduleRetry = vi.fn();
    const client = createCloudWordCopyClient({
      outbox: {
        enqueue: vi.fn(async () => ({ localQueueId: "queue-1", status: "queued" as const })),
        process: vi.fn(async () => ({ pending: true, status: "retry" as const })),
      } as never,
      preferences: { sync: vi.fn(async () => preferences) },
      scheduleRetry,
    });

    await expect(client.copy(input)).resolves.toBe("queued");
    expect(scheduleRetry).toHaveBeenCalledOnce();
  });
});
