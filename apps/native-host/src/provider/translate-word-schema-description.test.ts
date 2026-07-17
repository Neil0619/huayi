import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("tells JSON-output providers to merge meanings that share a part of speech", () => {
  const path = fileURLToPath(new URL("./schemas/translate-word.json", import.meta.url));
  const source = readFileSync(path, "utf8");

  expect(source).toMatch(/one group per partOfSpeech/iu);
  expect(source).toMatch(/merge/iu);
});
