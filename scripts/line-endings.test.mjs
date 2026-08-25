import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("repository checkout pins text files to LF on every platform", async () => {
  const attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");

  assert.equal(attributes, "* text=auto eol=lf\n");
});
