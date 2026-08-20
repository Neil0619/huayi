import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  parseSubmissionOutboxRequest,
  parseSubmissionOutboxResponse,
} from "./index.js";

describe("Store SubmissionOutbox messages", () => {
  it("accepts only fixed parameter-free commands", () => {
    for (const type of [
      "store/submission-outbox-status",
      "store/submission-outbox-retry",
      "store/submission-outbox-clear",
    ]) {
      expect(parseSubmissionOutboxRequest({ messageVersion: STORE_MESSAGE_VERSION, type })).toEqual(
        {
          messageVersion: STORE_MESSAGE_VERSION,
          type,
        },
      );
    }
    expect(() =>
      parseSubmissionOutboxRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        sourceText: "private text",
        type: "store/submission-outbox-retry",
      }),
    ).toThrow();
  });

  it("returns only bounded aggregate queue metadata", () => {
    expect(
      parseSubmissionOutboxResponse({
        count: 2,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "status",
        state: "queued",
        type: "store/submission-outbox-result",
      }),
    ).toMatchObject({ count: 2, state: "queued" });
    expect(
      parseSubmissionOutboxResponse({
        count: 2,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "client-upgrade-required",
        state: "client-upgrade-required",
        type: "store/submission-outbox-result",
      }),
    ).toMatchObject({ count: 2, state: "client-upgrade-required" });
    expect(
      parseSubmissionOutboxResponse({
        count: 2,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "status",
        state: "not-configured",
        type: "store/submission-outbox-result",
      }),
    ).toMatchObject({ count: 2, state: "not-configured" });
    expect(
      parseSubmissionOutboxResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "status",
        state: "not-configured",
        type: "store/submission-outbox-result",
      }),
    ).toMatchObject({ state: "not-configured" });
    expect(() =>
      parseSubmissionOutboxResponse({
        clientVersion: "1.0.0",
        count: 2,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "client-upgrade-required",
        state: "client-upgrade-required",
        type: "store/submission-outbox-result",
      }),
    ).toThrow();
    expect(() =>
      parseSubmissionOutboxResponse({
        count: 1,
        idempotencyKey: "secret-key",
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "status",
        state: "queued",
        type: "store/submission-outbox-result",
      }),
    ).toThrow();
    expect(() =>
      parseSubmissionOutboxResponse({
        count: 0,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13T00:00:00.000Z",
        outcome: "status",
        state: "queued",
        type: "store/submission-outbox-result",
      }),
    ).toThrow();
    expect(() =>
      parseSubmissionOutboxResponse({
        count: 1,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "tomorrow",
        outcome: "status",
        state: "queued",
        type: "store/submission-outbox-result",
      }),
    ).toThrow();
    expect(() =>
      parseSubmissionOutboxResponse({
        count: 1,
        messageVersion: STORE_MESSAGE_VERSION,
        oldestQueuedAt: "2026-08-13",
        outcome: "status",
        state: "queued",
        type: "store/submission-outbox-result",
      }),
    ).toThrow();
  });
});
