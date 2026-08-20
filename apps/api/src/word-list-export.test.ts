import { describe, expect, it } from "vitest";

import { createWordListExport } from "./word-list-export.js";

describe("WordListExport", () => {
  it("returns canonical keys sorted as UTF-8 LF text with one final newline", async () => {
    const exportWords = createWordListExport({
      repository: {
        listCanonicalKeys: async () => ["accountable", "café", "make do"],
      },
    });
    await expect(exportWords.text("owner-1")).resolves.toBe("accountable\ncafé\nmake do\n");
  });

  it("returns an empty file for an empty owner library", async () => {
    const exportWords = createWordListExport({
      repository: { listCanonicalKeys: async () => [] },
    });
    await expect(exportWords.text("owner-1")).resolves.toBe("");
  });
});
