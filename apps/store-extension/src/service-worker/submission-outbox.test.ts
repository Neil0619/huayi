import { describe, expect, it, vi } from "vitest";

import { createSubmissionOutbox, type SubmissionOutboxState } from "./submission-outbox.js";
import type { StoredExtensionSession } from "./extension-session-vault.js";

const capture = {
  payload: { kind: "sentence" as const, sourceText: "This works." },
  type: "study-capture" as const,
};
const cloudWordCopy = {
  payload: {
    collectedAt: "2026-08-13T00:00:00.000Z",
    contextualMeaningZh: "维持",
    headword: "sustain",
    sentence: "The effort cannot be sustained.",
  },
  type: "cloud-word-copy" as const,
};
const preferences = {
  cloudWordCopyMode: "enabled" as const,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "manual" as const,
  updatedAt: "2026-08-13T00:00:00.000Z",
};
const submittedCapture = {
  capture: {
    captureCount: 1,
    createdAt: "2026-08-13T00:00:00.000Z",
    firstCapturedAt: "2026-08-13T00:00:00.000Z",
    id: "capture-1",
    kind: "sentence" as const,
    lastCapturedAt: "2026-08-13T00:00:00.000Z",
    normalizedTextHash: "a".repeat(64),
    revision: 1,
    sourceText: "This works.",
    status: "pending" as const,
    updatedAt: "2026-08-13T00:00:00.000Z",
  },
  outcome: "created" as const,
  undo: { captureId: "capture-1", expectedRevision: 1 },
};

function setup(
  options: {
    api?: { submit: ReturnType<typeof vi.fn> } | null;
    clientVersion?: string;
    uploadAllowed?: boolean;
    session?: StoredExtensionSession | null;
  } = {},
) {
  let state: SubmissionOutboxState = { items: [] };
  let session =
    options.session === undefined
      ? { expiresAt: "2026-09-13T00:00:00.000Z", preferences, token: "t".repeat(32) }
      : options.session;
  const vault = {
    clear: vi.fn(async () => {
      state = { items: [] };
    }),
    read: vi.fn(async () => structuredClone(state)),
    write: vi.fn(async (value: SubmissionOutboxState) => {
      state = structuredClone(value);
    }),
  };
  const sessionVault = {
    clearSession: vi.fn(async () => {
      session = null;
    }),
    readSession: vi.fn(async () => session),
  };
  const api =
    options.api === undefined
      ? { submit: vi.fn(async () => ({ response: submittedCapture, type: "study-capture" })) }
      : options.api;
  let nextId = 1;
  const outbox = createSubmissionOutbox({
    allowUpload: async () => options.uploadAllowed ?? true,
    api,
    clientVersion: options.clientVersion ?? "1.0.0",
    createIdempotencyKey: () => `submission-${nextId++}`,
    now: () => Date.parse("2026-08-13T00:00:00.000Z"),
    sessionVault,
    vault,
  });
  return { api, outbox, sessionVault, state: () => state, vault };
}

describe("authenticated StudyCapture SubmissionOutbox", () => {
  it("durably submits a strict CloudWordCopy without exposing it in aggregate status", async () => {
    const context = setup();
    await expect(context.outbox.enqueue(cloudWordCopy)).resolves.toMatchObject({
      localQueueId: "submission-1",
      status: "queued",
    });
    await expect(context.outbox.status()).resolves.toMatchObject({ count: 1, state: "queued" });
    await expect(context.outbox.process()).resolves.toMatchObject({ status: "submitted" });
    expect(context.api?.submit).toHaveBeenCalledWith(cloudWordCopy, "submission-1", "t".repeat(32));
  });

  it("keeps unauthenticated or unconfigured learning intent local-only", async () => {
    for (const configured of [setup({ session: null }), setup({ api: null })]) {
      await expect(configured.outbox.enqueue(capture)).resolves.toEqual({ status: "local-only" });
      expect(configured.vault.write).not.toHaveBeenCalled();
    }
  });

  it("durably queues only original intent, then submits and removes it with one stable key", async () => {
    const context = setup();
    await expect(context.outbox.enqueue(capture)).resolves.toEqual({
      localQueueId: "submission-1",
      status: "queued",
    });
    expect(context.state().items).toHaveLength(1);

    await expect(context.outbox.process()).resolves.toMatchObject({
      pending: false,
      status: "submitted",
    });
    expect(context.api?.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { kind: "sentence", sourceText: "This works." },
        type: "study-capture",
      }),
      "submission-1",
      "t".repeat(32),
    );
    expect(JSON.stringify(context.api?.submit.mock.calls[0]?.[0])).not.toContain("translationZh");
    expect(context.state().items).toEqual([]);
  });

  it("removes only the current-card local queue item without submitting it", async () => {
    const context = setup();
    await context.outbox.enqueue(capture);
    await context.outbox.enqueue({
      payload: { kind: "phrase", sourceText: "worth learning" },
      type: "study-capture",
    });

    await expect(context.outbox.remove("submission-1")).resolves.toBe(true);
    expect(context.state().items).toEqual([
      expect.objectContaining({ idempotencyKey: "submission-2" }),
    ]);
    expect(context.api?.submit).not.toHaveBeenCalled();
  });

  it("retains transient failures for the same idempotent retry", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce({ kind: "transient" })
      .mockResolvedValueOnce(undefined);
    const context = setup({ api: { submit } });
    await context.outbox.enqueue(capture);

    await expect(context.outbox.process()).resolves.toEqual({ pending: true, status: "retry" });
    await expect(context.outbox.process()).resolves.toMatchObject({
      pending: false,
      status: "submitted",
    });
    expect(submit.mock.calls.map((call) => call[1])).toEqual(["submission-1", "submission-1"]);
  });

  it("durably blocks 426 without retrying until the client version changes", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce({ kind: "client-upgrade-required" })
      .mockResolvedValueOnce(undefined);
    const context = setup({ api: { submit } });
    await context.outbox.enqueue(capture);

    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "client-upgrade-required",
    });
    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "client-upgrade-required",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(context.state()).toMatchObject({
      clientUpgradeRequiredAtVersion: "1.0.0",
      items: [expect.objectContaining({ idempotencyKey: "submission-1" })],
    });
    expect(context.sessionVault.clearSession).not.toHaveBeenCalled();
    await expect(context.outbox.status()).resolves.toEqual({
      count: 1,
      oldestQueuedAt: "2026-08-13T00:00:00.000Z",
      state: "client-upgrade-required",
    });

    const upgraded = createSubmissionOutbox({
      allowUpload: async () => true,
      api: context.api,
      clientVersion: "1.0.1",
      createIdempotencyKey: () => "unused",
      now: () => Date.parse("2026-08-13T00:00:00.000Z"),
      sessionVault: context.sessionVault,
      vault: context.vault,
    });
    await expect(upgraded.status()).resolves.toEqual({
      count: 1,
      oldestQueuedAt: "2026-08-13T00:00:00.000Z",
      state: "queued",
    });
    expect(context.state()).not.toHaveProperty("clientUpgradeRequiredAtVersion");
    await expect(upgraded.process()).resolves.toMatchObject({
      pending: false,
      status: "submitted",
    });
    expect(submit.mock.calls.map((call) => call[1])).toEqual(["submission-1", "submission-1"]);
  });

  it("keeps capturing under one upgrade block without scheduling another retry", async () => {
    const context = setup({
      api: { submit: vi.fn(async () => Promise.reject({ kind: "client-upgrade-required" })) },
    });
    await context.outbox.enqueue(capture);
    await context.outbox.process();
    await expect(context.outbox.enqueue(capture)).resolves.toMatchObject({
      status: "client-upgrade-required",
    });
    expect(context.state().items).toHaveLength(2);
  });

  it("keeps the upgrade block when current-card undo removes only one queued item", async () => {
    const submit = vi.fn(async () => Promise.reject({ kind: "client-upgrade-required" }));
    const context = setup({ api: { submit } });
    await context.outbox.enqueue(capture);
    await context.outbox.enqueue(cloudWordCopy);
    await context.outbox.process();

    await expect(context.outbox.remove("submission-1")).resolves.toBe(true);
    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "client-upgrade-required",
    });

    expect(submit).toHaveBeenCalledOnce();
    expect(context.state()).toEqual({
      clientUpgradeRequiredAtVersion: "1.0.0",
      items: [expect.objectContaining({ idempotencyKey: "submission-2" })],
    });
  });

  it("clears an invalid session before honoring a same-version upgrade block", async () => {
    const context = setup({
      api: { submit: vi.fn(async () => Promise.reject({ kind: "client-upgrade-required" })) },
    });
    await context.outbox.enqueue(capture);
    await context.outbox.process();
    await context.sessionVault.clearSession();

    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "session-invalid",
    });
    expect(context.state().items).toEqual([]);
  });

  it("hard-deletes expired items before honoring a durable upgrade block", async () => {
    const submit = vi.fn(async () => Promise.reject({ kind: "client-upgrade-required" }));
    const context = setup({ api: { submit } });
    await context.outbox.enqueue(capture);
    await context.outbox.process();
    await context.outbox.enqueue(capture);
    const expired = context.state().items[0];
    if (expired === undefined) throw new Error("Expected a queued submission.");
    expired.createdAt = "2026-08-05T23:59:59.000Z";

    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "client-upgrade-required",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(context.state()).toEqual({
      clientUpgradeRequiredAtVersion: "1.0.0",
      items: [expect.objectContaining({ idempotencyKey: "submission-2" })],
    });
  });

  it("projects only aggregate status and cleans invalid account-bound queues", async () => {
    const context = setup();
    await context.outbox.enqueue(capture);
    await expect(context.outbox.status()).resolves.toEqual({
      count: 1,
      oldestQueuedAt: "2026-08-13T00:00:00.000Z",
      state: "queued",
    });
    expect(JSON.stringify(await context.outbox.status())).not.toContain("This works.");

    const disconnected = setup({ session: null });
    await disconnected.vault.write(context.state());
    await expect(disconnected.outbox.status()).resolves.toEqual({
      state: "session-unavailable",
    });
    expect(disconnected.state().items).toEqual([]);
  });

  it("clears the session and account-bound queue after permanent authentication failure", async () => {
    const context = setup({
      api: { submit: vi.fn(async () => Promise.reject({ kind: "authentication" })) },
    });
    await context.outbox.enqueue(capture);

    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "session-invalid",
    });
    expect(context.sessionVault.clearSession).toHaveBeenCalledOnce();
    expect(context.vault.clear).toHaveBeenCalledOnce();
  });

  it("bounds the encrypted queue at 20 and hard-drops items older than seven days", async () => {
    const context = setup();
    for (let index = 0; index < 20; index += 1) {
      await expect(context.outbox.enqueue(capture)).resolves.toMatchObject({ status: "queued" });
    }
    await expect(context.outbox.enqueue(capture)).resolves.toEqual({ status: "local-only" });
    expect(context.state().items).toHaveLength(20);

    const first = context.state().items[0];
    if (first === undefined) throw new Error("Expected a queued submission.");
    first.createdAt = "2026-08-05T23:59:59.000Z";
    await expect(context.outbox.enqueue(capture)).resolves.toMatchObject({ status: "queued" });
    expect(context.state().items).toHaveLength(20);
    expect(context.state().items.some((item) => item.createdAt === first.createdAt)).toBe(false);
  });

  it("drops one permanently invalid item without damaging the active session", async () => {
    const context = setup({
      api: { submit: vi.fn(async () => Promise.reject({ kind: "permanent" })) },
    });
    await context.outbox.enqueue(capture);

    await expect(context.outbox.process()).resolves.toEqual({
      pending: false,
      status: "discarded",
    });
    expect(context.sessionVault.clearSession).not.toHaveBeenCalled();
    expect(context.state().items).toEqual([]);
  });

  it("deletes pending content without upload after network consent is withdrawn", async () => {
    const context = setup();
    await context.outbox.enqueue(capture);
    const revoked = createSubmissionOutbox({
      allowUpload: async () => false,
      api: context.api,
      clientVersion: "1.0.0",
      createIdempotencyKey: () => "unused",
      now: () => Date.parse("2026-08-13T00:00:00.000Z"),
      sessionVault: context.sessionVault,
      vault: context.vault,
    });

    await expect(revoked.process()).resolves.toEqual({ pending: false, status: "discarded" });
    expect(context.api?.submit).not.toHaveBeenCalled();
    expect(context.vault.clear).toHaveBeenCalled();
  });
});
