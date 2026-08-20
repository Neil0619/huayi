import { describe, expect, it } from "vitest";

import { createAnalysisHistoryCursor } from "./analysis-history-cursor.js";
import { createPracticeHistoryCursor } from "./practice-history-cursor.js";

describe("practice history cursor", () => {
  it("round-trips nullable completion boundaries and rejects tampering or cross-context cursors", () => {
    const key = new Uint8Array(32).fill(7);
    const cursor = createPracticeHistoryCursor(key);
    const incomplete = cursor.encode({ completedAt: null, id: "session-2" });
    expect(cursor.decode(incomplete)).toEqual({ completedAt: null, id: "session-2", version: 1 });
    const complete = cursor.encode({ completedAt: "2026-08-13T05:05:00.000Z", id: "session-1" });
    expect(cursor.decode(complete)).toMatchObject({ id: "session-1" });
    expect(() => cursor.decode(`${complete}x`)).toThrow();
    const analysis = createAnalysisHistoryCursor(key).encode({
      createdAt: "2026-08-13T05:05:00.000Z",
      id: "session-1",
    });
    expect(() => cursor.decode(analysis)).toThrow();
  });
});
