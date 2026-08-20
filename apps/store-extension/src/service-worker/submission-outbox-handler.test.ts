import { describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { handleSubmissionOutboxMessage } from "./submission-outbox-handler.js";

const request = (type: string) => ({ messageVersion: STORE_MESSAGE_VERSION, type });

describe("privileged SubmissionOutbox handler", () => {
  it("accepts only the exact extension popup sender", async () => {
    const status = vi.fn(async () => ({ state: "empty" as const }));
    const outbox = { clear: vi.fn(), process: vi.fn(), status };
    await expect(
      handleSubmissionOutboxMessage(request("store/submission-outbox-status"), {
        outbox,
        runtimeId: "extension-id",
        scheduleRetry: vi.fn(),
        sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
      }),
    ).resolves.toMatchObject({ outcome: "status", state: "empty" });
    for (const sender of [
      { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
      { id: "extension-id", url: "chrome-extension://extension-id/popup.html?next=1" },
      { id: "other", url: "chrome-extension://extension-id/popup.html" },
    ]) {
      await expect(
        handleSubmissionOutboxMessage(request("store/submission-outbox-status"), {
          outbox,
          runtimeId: "extension-id",
          scheduleRetry: vi.fn(),
          sender,
        }),
      ).resolves.toBeUndefined();
    }
    expect(status).toHaveBeenCalledOnce();
  });

  it("retries through the existing runner and schedules the same pending item", async () => {
    const scheduleRetry = vi.fn();
    const outbox = {
      clear: vi.fn(),
      process: vi.fn(async () => ({ pending: true, status: "retry" as const })),
      status: vi.fn(async () => ({
        count: 1,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        state: "queued" as const,
      })),
    };
    await expect(
      handleSubmissionOutboxMessage(request("store/submission-outbox-retry"), {
        outbox,
        runtimeId: "extension-id",
        scheduleRetry,
        sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
      }),
    ).resolves.toMatchObject({ outcome: "retry-pending", state: "queued" });
    expect(scheduleRetry).toHaveBeenCalledOnce();
  });

  it("projects a client upgrade block without scheduling another retry", async () => {
    const scheduleRetry = vi.fn();
    const outbox = {
      clear: vi.fn(),
      process: vi.fn(async () => ({
        pending: false,
        status: "client-upgrade-required" as const,
      })),
      status: vi.fn(async () => ({
        count: 1,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        state: "client-upgrade-required" as const,
      })),
    };
    await expect(
      handleSubmissionOutboxMessage(request("store/submission-outbox-retry"), {
        outbox,
        runtimeId: "extension-id",
        scheduleRetry,
        sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
      }),
    ).resolves.toMatchObject({
      outcome: "client-upgrade-required",
      state: "client-upgrade-required",
    });
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("projects an adapter-missing queue without scheduling another retry", async () => {
    const scheduleRetry = vi.fn();
    const outbox = {
      clear: vi.fn(),
      process: vi.fn(async () => ({ pending: false, status: "not-configured" as const })),
      status: vi.fn(async () => ({
        count: 1,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        state: "not-configured" as const,
      })),
    };
    await expect(
      handleSubmissionOutboxMessage(request("store/submission-outbox-retry"), {
        outbox,
        runtimeId: "extension-id",
        scheduleRetry,
        sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
      }),
    ).resolves.toMatchObject({ outcome: "idle", state: "not-configured" });
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("clears only the local SubmissionOutbox after a strict command", async () => {
    const clear = vi.fn(async () => undefined);
    await expect(
      handleSubmissionOutboxMessage(request("store/submission-outbox-clear"), {
        outbox: { clear, process: vi.fn(), status: vi.fn() },
        runtimeId: "extension-id",
        scheduleRetry: vi.fn(),
        sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
      }),
    ).resolves.toMatchObject({ outcome: "cleared", state: "empty" });
    expect(clear).toHaveBeenCalledOnce();
  });
});
