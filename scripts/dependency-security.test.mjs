import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const miniRequire = createRequire(new URL("../apps/miniprogram/package.json", import.meta.url));
const consumers = [
  ["Vite", require.resolve("vite/package.json")],
  ["Taro", miniRequire.resolve("@tarojs/webpack5-runner/package.json")],
];

for (const [name, manifest] of consumers) {
  test(`${name}: untrusted CSS cannot load a source map outside its input directory`, async (t) => {
    const postcss = createRequire(manifest)("postcss");
    const directory = await mkdtemp(join(tmpdir(), "huayi-postcss-security-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const cssDirectory = join(directory, "css");
    await mkdir(cssDirectory);
    const marker = "SELF_OWNED_MAP_MUST_NOT_LEAK";
    const outsideMap = join(directory, "private.map");
    await writeFile(
      outsideMap,
      JSON.stringify({
        version: 3,
        sources: ["private.css"],
        sourcesContent: [marker],
        names: [],
        mappings: "AAAA",
      }),
    );
    const css = `a { color: red }\n/*# sourceMappingURL=${outsideMap} */`;
    for (const from of [undefined, join(cssDirectory, "input.css")]) {
      const result = await postcss([]).process(css, {
        from,
        map: { inline: false, annotation: false },
      });
      assert.equal(result.map?.toString().includes(marker), false);
      assert.match(result.css, /color: red/u);
    }
  });
}

test("Taro esbuild still compiles TypeScript synchronously", () => {
  const helperRequire = createRequire(miniRequire.resolve("@tarojs/helper/package.json"));
  const esbuild = helperRequire("esbuild");
  const result = esbuild.transformSync("export const answer: number = 42", {
    loader: "ts",
    format: "cjs",
  });
  assert.match(result.code, /answer = 42/u);
  assert.equal(result.warnings.length, 0);
});

test("copy-webpack-plugin serialization preserves cache data and escapes script content", () => {
  const runnerRequire = createRequire(miniRequire.resolve("@tarojs/webpack5-runner/package.json"));
  const copyRequire = createRequire(runnerRequire.resolve("copy-webpack-plugin/package.json"));
  const serialize = copyRequire("serialize-javascript");
  const serialized = serialize({ source: "</script>", options: { cache: true }, size: 42 });
  assert.doesNotMatch(serialized, /<\/script>/u);
  assert.deepEqual(JSON.parse(serialized), {
    source: "</script>",
    options: { cache: true },
    size: 42,
  });
});
