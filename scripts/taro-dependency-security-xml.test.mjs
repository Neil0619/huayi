import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const appRequire = createRequire(new URL("../apps/miniprogram/package.json", import.meta.url));
const runnerRequire = createRequire(appRequire.resolve("@tarojs/webpack5-runner/package.json"));
const { default: MiniPlugin } = runnerRequire("./dist/plugins/MiniPlugin.js");
const { componentConfig } = runnerRequire("./dist/utils/component.js");
const compiler = { webpack: { sources: runnerRequire("webpack-sources") } };
const markup =
  '<view wx:if="{{ready}}">\n  <image src="{{url}}" />\n  <text>{{label}}</text>\n</view>';

function plugin(collapseWhitespace) {
  const result = Object.create(MiniPlugin.prototype);
  result.options = {
    combination: { config: { minifyXML: { collapseWhitespace } } },
    sourceDir: path.resolve("self-owned-source"),
    fileType: { templ: ".wxml" },
  };
  result.getComponentName = (file) => path.basename(file);
  result.getTemplatePath = (name) => `${name}.wxml`;
  return result;
}

test("Taro XML awaits maintained minifier while retaining WXML bindings and closing slashes", async () => {
  const instance = plugin(true);
  const compilation = { assets: {} };
  const pending = instance.generateTemplateFile(compilation, compiler, "page", () => markup);
  assert.equal(typeof pending?.then, "function");
  await pending;
  assert.equal(
    compilation.assets["page.wxml"].source(),
    '<view wx:if="{{ready}}"><image src="{{url}}"/><text>{{label}}</text></view>',
  );
});

test("Taro XML preserves exact template when whitespace minification is disabled", async () => {
  const compilation = { assets: {} };
  await plugin(false).generateTemplateFile(compilation, compiler, "page", () => markup);
  assert.equal(compilation.assets["page.wxml"].source(), markup);
});

test("Taro independent subpackage awaits every template and ignores other child compilations", async () => {
  const instance = plugin(true);
  instance.options.template = {
    isSupportRecursive: false,
    buildBaseComponentTemplate: () => markup,
    buildTemplate: () => markup,
    buildCustomComponentTemplate: () => markup,
    buildPageTemplate: () => markup,
  };
  instance.filesConfig = {};
  instance.independentPackages = new Map([
    ["other", { pages: ["other/page"] }],
    ["sub", { pages: ["sub/page"] }],
  ]);
  instance.pages = new Set([
    { path: "other/page", name: "other/page" },
    { path: "sub/page", name: "sub/page" },
  ]);
  instance.getComponentName = (name) => name;
  instance.getConfigFilePath = (name) => name;
  instance.generateConfigFile = () => undefined;
  instance.generateXSFile = () => undefined;
  const compilation = { __name: "sub", assets: {} };
  await instance.generateIndependentMiniFiles(compilation, compiler);
  assert.deepEqual(Object.keys(compilation.assets).sort(), [
    "sub/base.wxml",
    "sub/comp.wxml",
    "sub/custom-wrapper.wxml",
    "sub/page.wxml",
  ]);
  for (const asset of Object.values(compilation.assets)) {
    assert.equal(typeof asset.source(), "string");
    assert.doesNotMatch(asset.source(), /\n/);
  }
});

test("Taro XML generator completes every base, wrapper, component and page asset before resolving", async (t) => {
  const instance = plugin(true);
  const originalWrapper = componentConfig.thirdPartyComponents.get("custom-wrapper");
  componentConfig.thirdPartyComponents.set("custom-wrapper", new Set());
  t.after(() => {
    if (originalWrapper)
      componentConfig.thirdPartyComponents.set("custom-wrapper", originalWrapper);
    else componentConfig.thirdPartyComponents.delete("custom-wrapper");
  });
  Object.assign(instance.options, {
    blended: true,
    newBlended: true,
    template: {
      isSupportRecursive: false,
      buildBaseComponentTemplate: () => markup,
      buildTemplate: () => markup,
      buildCustomComponentTemplate: () => markup,
      buildPageTemplate: () => markup,
    },
  });
  instance.filesConfig = {};
  instance.components = new Set([{ path: "component", name: "component" }]);
  instance.pages = new Set([{ path: "page", name: "page" }]);
  instance.getConfigFilePath = (name) => name;
  instance.getIndependentPackage = () => false;
  for (const name of [
    "generateConfigFile",
    "generateXSFile",
    "generateTabBarFiles",
    "injectCommonStyles",
  ])
    instance[name] = () => undefined;
  const generate = instance.generateTemplateFile.bind(instance);
  instance.generateTemplateFile = async (...args) => {
    await new Promise((resolve) => setImmediate(resolve));
    await generate(...args);
  };
  const compilation = { assets: {}, getAssets: () => [] };
  await instance.generateMiniFiles(compilation, compiler);
  assert.deepEqual(Object.keys(compilation.assets).sort(), [
    "base.wxml",
    "comp.wxml",
    "component.wxml",
    "custom-wrapper.wxml",
    "page.wxml",
  ]);
  for (const asset of Object.values(compilation.assets)) {
    assert.equal(typeof asset.source(), "string");
    assert.match(asset.source(), /wx:if="\{\{ready\}\}"/);
    assert.doesNotMatch(asset.source(), /\n/);
  }
});
