import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const appRequire = createRequire(new URL("../apps/miniprogram/package.json", import.meta.url));
const runnerRequire = createRequire(appRequire.resolve("@tarojs/webpack5-runner/package.json"));
const simulatorRequire = createRequire(runnerRequire.resolve("miniprogram-simulate/package.json"));
const wxss = simulatorRequire("./src/wxss.js");
const less = simulatorRequire("less");

test("simulator uses maintained CSS parsers through its actual dependency resolution", () => {
  const postcssVersion = simulatorRequire("postcss/package.json").version;
  assert.equal(postcssVersion, "8.5.28");
  assert.equal(less.version[0], 4);
});

test("simulator preserves selector prefixes, keyframes, rpx, nesting and LESS 3 arithmetic", () => {
  const output = wxss.compile(
    "@gap: 8px; .outer { width: @gap / 2; .inner { margin: 2rpx; } } @keyframes pulse { 50% { opacity: .5; } }",
    { less: true, prefix: "fixture" },
  );
  assert.match(output, /\.fixture--outer\{width:4px\}/);
  assert.match(output, /\.fixture--outer \.fixture--inner\{margin:2rpx\}/);
  assert.match(output, /@keyframes pulse\{50%\{opacity:\.5\}\}/);
});

test("simulator CSS compilation never loads an external source map", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taro-css-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, "self-owned.map");
  await fs.writeFile(marker, "this file is deliberately not JSON");
  const output = wxss.compile(`.safe { color: red; }\n/*# sourceMappingURL=${marker} */`, {
    prefix: "fixture",
  });
  assert.equal(output, ".fixture--safe{color:red}");
});

test("simulator LESS preserves synchronous local imports and image dimensions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taro-less-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const imported = path.join(root, "self-owned.less");
  await fs.writeFile(imported, "@width: 12px;");
  const image = path.join(root, "self-owned.png");
  await fs.writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const output = wxss.compile(
    `@import "${imported.replaceAll("\\", "/")}"; .image { width: @width / 2; height: image-height("${image.replaceAll("\\", "/")}"); }`,
    { less: true, prefix: "fixture" },
  );
  assert.equal(output, ".fixture--image{width:6px;height:1px}");
});

test("simulator reports LESS failures instead of silently emitting uncompiled input", () => {
  assert.throws(
    () => wxss.compile(".broken { color: @missing; }", { less: true }),
    /missing|undefined/i,
  );
});
