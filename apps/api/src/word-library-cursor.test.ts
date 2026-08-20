import { describe, expect, it } from "vitest";

import { createWordLibraryCursor } from "./word-library-cursor.js";

describe("word library cursors", () => {
  it("separates word and context signatures", () => {
    const cursor = createWordLibraryCursor(Buffer.alloc(32, 8));
    const word = cursor.words.encode({
      createdAt: "2026-08-13T01:00:00.000Z",
      id: "word-1",
    });
    const context = cursor.contexts.encode({
      id: "context-1",
      observedAt: "2026-08-13T02:00:00.000Z",
      wordId: "word-1",
    });
    expect(cursor.words.decode(word)).toMatchObject({ id: "word-1" });
    expect(() => cursor.contexts.decode(word)).toThrow();
    expect(() => cursor.words.decode(context)).toThrow();
  });
});
