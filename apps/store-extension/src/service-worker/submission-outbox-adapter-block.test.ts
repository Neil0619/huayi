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

function setup() {
  let state: SubmissionOutboxState = { items: [] };
  let session: StoredExtensionSession | null = {
    expiresAt: "2026-09-13T00:00:00.000Z",
    preferences,
    token: "t".repeat(32),
  };
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
  const submit = vi.fn(async () => undefined);
  let nextId = 1;
  const outbox = createSubmissionOutbox({
    allowUpload: async () => true,
    api: { submit },
    clientVersion: "1.0.0",
    createIdempotencyKey: () => `submission-${nextId++}`,
    now: () => Date.parse("2026-08-13T00:00:00.000Z"),
    sessionVault,
    vault,
  });
  return { outbox, sessionVault, state: () => state, submit, vault };
}

function blocked(context: ReturnType<typeof setup>, allowUpload = true) {
  return createSubmissionOutbox({
    allowUpload: async () => allowUpload,
    api: null,
    clientVersion: "1.0.0",
    createIdempotencyKey: () => "unused",
    now: () => Date.parse("2026-08-13T00:00:00.000Z"),
    sessionVault: context.sessionVault,
    vault: context.vault,
  });
}

describe("SubmissionOutbox adapter-missing block", () => {
  it("retains the encrypted queue behind one stable aggregate block", async () => {
    const context = setup();
    await context.outbox.enqueue(capture);
    const unavailable = blocked(context);

    await expect(unavailable.enqueue(capture)).resolves.toEqual({ status: "local-only" });
    await expect(unavailable.process()).resolves.toEqual({
      pending: false,
      status: "not-configured",
    });
    await expect(unavailable.status()).resolves.toEqual({
      count: 1,
      oldestQueuedAt: "2026-08-13T00:00:00.000Z",
      state: "not-configured",
    });
    expect(context.state()).toEqual({
      items: [expect.objectContaining({ idempotencyKey: "submission-1" })],
    });
    expect(context.vault.clear).not.toHaveBeenCalled();
    expect(context.sessionVault.clearSession).not.toHaveBeenCalled();
    expect(context.submit).not.toHaveBeenCalled();
  });

  it("applies seven-day retention when enqueue cannot submit", async () => {
    const context = setup();
    await context.outbox.enqueue(capture);
    await context.outbox.enqueue(cloudWordCopy);
    const expired = context.state().items[0];
    if (expired === undefined) throw new Error("Expected an existing queued submission.");
    expired.createdAt = "2026-08-05T23:59:59.000Z";

    await expect(blocked(context).enqueue(capture)).resolves.toEqual({ status: "local-only" });
    expect(context.state()).toEqual({
      items: [expect.objectContaining({ idempotencyKey: "submission-2" })],
    });
  });

  it("reports an empty unconfigured build without fabricating queue metadata", async () => {
    const context = setup();
    await expect(blocked(context).status()).resolves.toEqual({ state: "not-configured" });
    expect(context.vault.clear).not.toHaveBeenCalled();
  });

  it("keeps consent and session invalidation ahead of the capability block", async () => {
    const revoked = setup();
    await revoked.outbox.enqueue(capture);
    await expect(blocked(revoked, false).process()).resolves.toEqual({
      pending: false,
      status: "discarded",
    });
    expect(revoked.state().items).toEqual([]);

    const disconnected = setup();
    await disconnected.outbox.enqueue(capture);
    await disconnected.sessionVault.clearSession();
    await expect(blocked(disconnected).status()).resolves.toEqual({
      state: "session-unavailable",
    });
    expect(disconnected.state().items).toEqual([]);
  });
});
