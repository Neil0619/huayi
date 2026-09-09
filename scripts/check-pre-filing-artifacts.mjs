import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const bundle = await readJson("artifacts/miniprogram/bundle-report.json");
const moduleNames = [];
function collect(modules = []) {
  for (const module of modules) {
    if (module.name) moduleNames.push(module.name);
    collect(module.modules);
  }
}
collect(bundle.modules);
assert(moduleNames.length > 0, "Missing actual weapp module report.");
assert.deepEqual(
  moduleNames.filter((name) =>
    /(?:\.(?:test|spec)\.[cm]?[jt]sx?|(?:draft|resource)-test-support|vitest|jsdom)/iu.test(name),
  ),
  [],
  "Test modules must not enter weapp.",
);
assert(
  moduleNames.some((name) => /react@18\.3\.1/u.test(name)),
  "Expected the mini-program React 18 runtime.",
);
assert(!moduleNames.some((name) => /react@19\./u.test(name)), "Web React must not enter weapp.");
const project = await readJson("apps/miniprogram/dist/project.config.json");
assert.equal(project.appid, "touristappid", "This command creates an offline preview only.");
const miniApp = await readJson("apps/miniprogram/dist/app.json");
assert(
  miniApp.pages.includes("pages/login/index") && miniApp.pages.includes("pages/practice/index"),
);

const html = await readFile(resolve(root, "apps/web/dist/index.html"), "utf8");
assert(!/(?:src|href)=["'](?:https?:)?\/\//iu.test(html), "External Web entry resource.");
const assets = await readdir(resolve(root, "apps/web/dist/assets"));
for (const name of assets.filter((name) => name.endsWith(".css"))) {
  const css = await readFile(resolve(root, "apps/web/dist/assets", name), "utf8");
  assert(!/@import\s|url\(["']?(?:https?:)?\/\//iu.test(css), "External CSS/font resource.");
}

async function hashes(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(path));
    else
      result[relative(root, path)] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
  }
  return result;
}
const apiHashes = await hashes(resolve(process.argv[3] ?? resolve(root, "apps/api/dist")));
assert(
  !Object.keys(apiHashes).some((path) => path.includes("/test-support/")),
  "API build must exclude test support.",
);
const report = {
  checkedAt: new Date().toISOString(),
  status: "passed",
  weappModules: moduleNames.length,
  weappPages: miniApp.pages.length,
  webAssets: assets.length,
  artifacts: {
    ...(await hashes(resolve(root, "apps/web/dist"))),
    ...(await hashes(resolve(root, "apps/miniprogram/dist"))),
    ...apiHashes,
  },
};
if (process.argv[2])
  await writeFile(resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `Artifact audit passed: ${report.weappModules} weapp modules, ${report.weappPages} pages; Web entry/CSS use local resources.\n`,
);
