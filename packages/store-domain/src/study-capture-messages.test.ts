import { describe, expect, it } from "vitest";

import { STORE_MESSAGE_VERSION } from "./messages.js";
import {
  parseStoreStudyCaptureRequest,
  parseStoreStudyCaptureResponse,
} from "./study-capture-messages.js";

describe("Store StudyCapture messages", () => {
  it("accepts only minimum original intent and rejects page/model fields", () => {
    const request = {
      kind: "sentence",
      messageVersion: STORE_MESSAGE_VERSION,
      sourceText: "This is worth learning.",
      trigger: "automatic",
      type: "store/study-capture-create",
    } as const;
    expect(parseStoreStudyCaptureRequest(request)).toEqual(request);
    expect(() =>
      parseStoreStudyCaptureRequest({ ...request, url: "https://example.test" }),
    ).toThrow();
    expect(() =>
      parseStoreStudyCaptureRequest({ ...request, result: { translationZh: "秘密" } }),
    ).toThrow();
  });

  it("keeps remote and local current-card undo proofs distinct", () => {
    expect(
      parseStoreStudyCaptureResponse({
        captureId: "capture-1",
        expectedRevision: 2,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "created",
        type: "store/study-capture-result",
      }),
    ).toMatchObject({ outcome: "created" });
    expect(
      parseStoreStudyCaptureResponse({
        localQueueId: "queue-1",
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "queued",
        type: "store/study-capture-result",
      }),
    ).toMatchObject({ outcome: "queued" });
  });
});
