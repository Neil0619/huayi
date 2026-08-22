import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./acceptance-local-build.mjs", import.meta.url), "utf8");
const { ACCEPTANCE_LOCAL_BUILD_ORDER } = await import("./acceptance-local-build.mjs");

test("local acceptance build owns its clean workspace dependency order", () => {
  assert.deepEqual(ACCEPTANCE_LOCAL_BUILD_ORDER, [
    "@huayi/learning-domain",
    "@huayi/cloud-contracts",
    "@huayi/api",
    "@huayi/web",
  ]);
});

test("local acceptance build fixes the simulated model label only in the Web build", () => {
  assert.match(source, /VITE_ACCEPTANCE_MODEL:\s*"simulated"/u);
  assert.doesNotMatch(source, /startsWith\("VITE_ACCEPTANCE_MODEL="\)/u);
  assert.match(source, /VITE_API_ORIGIN:\s*await webApiOrigin\(\)/u);
});
