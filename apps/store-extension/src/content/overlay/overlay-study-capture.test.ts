import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reading } from "./store-overlay-controller.test-support.js";
import { OverlayStudyCapture } from "./overlay-study-capture.js";

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("current-card StudyCapture action", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("automatically captures only sentence/passage once and exposes created undo", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        captureId: "capture-1",
        expectedRevision: 1,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "created",
        type: "store/study-capture-result",
      })
      .mockResolvedValueOnce({
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "undone",
        type: "store/study-capture-result",
      });
    const capture = new OverlayStudyCapture({ acceptsUserGesture: () => true, send });
    const selection = reading("This is worth learning.", "sentence");
    capture.startAutomatic(selection);
    capture.startAutomatic(selection);
    await settle();
    capture.render(document.body, selection);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual({
      kind: "sentence",
      messageVersion: STORE_MESSAGE_VERSION,
      sourceText: "This is worth learning.",
      trigger: "automatic",
      type: "store/study-capture-create",
    });
    document.querySelector<HTMLButtonElement>("[data-study-capture-undo]")?.click();
    await settle();
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      captureId: "capture-1",
      expectedRevision: 1,
      type: "store/study-capture-undo-remote",
    });
    expect(document.body.textContent).toContain("加入收集箱");
  });

  it("keeps phrase manual and drops undo state when the card resets", async () => {
    const send = vi.fn(async () => ({
      localQueueId: "queue-1",
      messageVersion: STORE_MESSAGE_VERSION,
      outcome: "queued" as const,
      type: "store/study-capture-result" as const,
    }));
    const capture = new OverlayStudyCapture({ acceptsUserGesture: () => true, send });
    const selection = reading("worth learning", "phrase");
    capture.startAutomatic(selection);
    capture.render(document.body, selection);
    expect(send).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>("[data-study-capture-create]")?.click();
    await settle();
    expect(document.body.textContent).toContain("待联网加入");

    capture.reset();
    document.body.textContent = "";
    capture.render(document.body, selection);
    expect(document.querySelector("[data-study-capture-undo]")).toBeNull();
  });
});
