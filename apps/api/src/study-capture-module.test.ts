import { describe, expect, it, vi } from "vitest";

import { createStudyCaptureModule } from "./study-capture-module.js";

describe("StudyCapture module", () => {
  it("normalizes exact identity while preserving the first original text", async () => {
    const create = vi.fn(async (command) => ({
      capture: {
        captureCount: 1,
        createdAt: command.now,
        firstCapturedAt: command.now,
        id: "capture-1",
        kind: command.request.kind,
        lastCapturedAt: command.now,
        normalizedTextHash: command.normalizedTextHash,
        revision: 1,
        sourceText: command.request.sourceText,
        status: "pending",
        updatedAt: command.now,
      },
      outcome: "created",
      undo: { captureId: "capture-1", expectedRevision: 1 },
    }));
    const module = createStudyCaptureModule({
      cursorKey: new Uint8Array(32),
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      repository: {
        create,
        delete: vi.fn(),
        find: vi.fn(),
        list: vi.fn(),
        patch: vi.fn(),
      },
    });

    await module.create(
      "owner-a",
      { kind: "sentence", sourceText: "  You\u2019re   ready  " },
      "capture-key",
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedSourceText: "You're ready",
        normalizedTextHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        request: { kind: "sentence", sourceText: "You’re   ready" },
      }),
    );
  });
});
