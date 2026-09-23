import assert from "node:assert/strict";
import { Console } from "node:console";
import { request } from "node:http";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runInThisContext } from "node:vm";

const miniRequire = createRequire(new URL("../apps/miniprogram/package.json", import.meta.url));
const runnerManifest = miniRequire.resolve("@tarojs/webpack5-runner/package.json");
const runnerRequire = createRequire(runnerManifest);
const h5File = join(dirname(runnerManifest), "dist/index.h5.js");
const h5Source = await readFile(h5File, "utf8");
// Exercise the actual consumer's private option builder, without changing its public exports.
const loadOptions = runInThisContext(
  `(function(require, module, exports, __filename, __dirname, console) {
    ${h5Source}
    return { getOptions: getDevServerOptions, getProtocol: getDevServerProtocol };
  })`,
  { filename: h5File },
);
const { getOptions, getProtocol } = loadOptions(
  createRequire(h5File),
  { exports: {} },
  {},
  h5File,
  dirname(h5File),
  // Keep Taro's Unicode port logs separate from node:test's serialized stdout.
  // Node 22/24 can otherwise corrupt test events: nodejs/node#64706.
  new Console({ stdout: process.stderr, stderr: process.stderr }),
);

test("Taro H5 opens TLS endpoints with HTTPS, including native HTTP/2", () => {
  for (const type of ["https", "spdy", "http2"]) {
    assert.equal(getProtocol(type), "https");
    assert.equal(getProtocol({ type }), "https");
  }
  assert.equal(getProtocol("http"), "http");
});

test("Taro H5 defaults bind loopback and validate Host with WDS 5 options", async () => {
  const options = await getOptions(tmpdir(), { publicPath: "/", devServer: { port: 0 } });
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.allowedHosts, "auto");
  assert.equal(options.server, "http");
  assert.equal("https" in options, false);
});

test("Taro H5 preserves explicit TLS and converts legacy https configuration", async () => {
  const tls = { key: "fixture-key", cert: "fixture-cert" };
  const legacy = await getOptions(tmpdir(), {
    publicPath: "/",
    devServer: { port: 0, https: tls },
  });
  assert.deepEqual(legacy.server, { type: "https", options: tls });
  assert.equal("https" in legacy, false);
  const explicit = await getOptions(tmpdir(), {
    publicPath: "/",
    devServer: { port: 0, server: { type: "https", options: tls }, host: "localhost" },
  });
  assert.deepEqual(explicit.server, { type: "https", options: tls });
  assert.equal(explicit.host, "localhost");
});

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => (body += part));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(10000, () => req.destroy(new Error("Local dev server timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function waitForServedEdit(port) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const response = await get(port, "/main.js");
    if (/second-build-marker/u.test(response.body) || Date.now() >= deadline) return response;
    await delay(50);
  }
}

test("Taro H5 server builds, serves and watches locally while rejecting a foreign Host", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "huayi-h5-security-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, "entry.js");
  await writeFile(entry, 'console.log("first-build-marker");');
  const webpack = runnerRequire("webpack");
  const Server = runnerRequire("webpack-dev-server");
  const compiler = webpack({
    mode: "development",
    entry,
    output: { path: join(directory, "dist"), filename: "main.js", publicPath: "/" },
    infrastructureLogging: { level: "error" },
  });
  const options = await getOptions(directory, {
    publicPath: "/",
    devServer: { port: 0, open: false, client: { logging: "none" } },
  });
  const server = new Server(options, compiler);
  t.after(() => server.stop());
  await server.start();
  const port = server.server.address().port;
  const initial = await get(port, "/main.js");
  assert.equal(initial.status, 200);
  assert.match(initial.body, /first-build-marker/u);
  const rejected = await get(port, "/main.js", { host: "attacker.invalid" });
  assert.equal(rejected.status, 403);
  // A queued rebuild may finish with the old source before the edit is observed.
  await new Promise((resolve) => compiler.watching.invalidate(resolve));
  await writeFile(entry, 'console.log("second-build-marker");');
  const rebuilt = await waitForServedEdit(port);
  assert.equal(rebuilt.status, 200);
  assert.match(rebuilt.body, /second-build-marker/u);
});
