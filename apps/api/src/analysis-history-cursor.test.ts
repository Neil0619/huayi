import { describe, expect, it } from "vitest";

import { createAnalysisHistoryCursor } from "./analysis-history-cursor.js";
import { createLearningLibraryCursor } from "./learning-library-cursor.js";

describe("analysis history cursor", () => {
  it("round-trips a signed versioned boundary and rejects tampering or non-canonical input", () => {
    const cursor = createAnalysisHistoryCursor(new Uint8Array(32).fill(9));
    const boundary = { createdAt: "2026-08-12T10:00:00.000Z", id: "analysis-1" };
    const encoded = cursor.encode(boundary);
    expect(cursor.decode(encoded)).toEqual({ ...boundary, version: 1 });
    expect(() => cursor.decode(`${encoded}=`)).toThrowError(/cursor is invalid/iu);
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("a") ? "b" : "a"}`;
    expect(() => cursor.decode(tampered)).toThrowError(/cursor is invalid/iu);
  });

  it("rejects a learning-library cursor signed with the same production key", () => {
    const key = new Uint8Array(32).fill(9);
    const history = createAnalysisHistoryCursor(key);
    const libraryCursor = createLearningLibraryCursor(key).encode(
      {
        createdAt: "2026-08-13T03:00:00.000Z",
        id: "item-1",
      },
      "0".repeat(64),
    );

    expect(() => history.decode(libraryCursor)).toThrowError(/cursor is invalid/iu);
  });
});
