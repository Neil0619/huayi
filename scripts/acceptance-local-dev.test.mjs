import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createLoopbackEndpoints,
  listenServers,
  loadWebBundleSnapshot,
  requestCarriesBody,
  requestPathname,
  resolveStaticPath,
} from "./acceptance-local-dev.mjs";

test("local acceptance exposes every HTTPS service on IPv4 and IPv6 loopback", () => {
  let nextServerId = 0;
  const endpoints = createLoopbackEndpoints([8443, 8444, 8445], () => ({
    id: (nextServerId += 1),
  }));

  assert.deepEqual(
    endpoints.map(({ host, port }) => ({ host, port })),
    [
      { host: "127.0.0.1", port: 8443 },
      { host: "::1", port: 8443 },
      { host: "127.0.0.1", port: 8444 },
      { host: "::1", port: 8444 },
      { host: "127.0.0.1", port: 8445 },
      { host: "::1", port: 8445 },
    ],
  );
  assert.equal(new Set(endpoints.map(({ server }) => server.id)).size, 6);
});

test("local acceptance static server keeps every path inside the Web bundle", () => {
  const root = resolve("apps/web/dist");

  assert.equal(resolveStaticPath(root, "/assets/app.js"), resolve(root, "assets/app.js"));
  assert.equal(resolveStaticPath(root, "/"), resolve(root, "index.html"));
  assert.equal(resolveStaticPath(root, "/../../private"), null);
  assert.equal(resolveStaticPath(root, "/%2e%2e/%2e%2e/private"), null);
});

test("local acceptance preserves raw request path segments for traversal rejection", () => {
  assert.equal(requestPathname("/assets/app.js?v=1"), "/assets/app.js");
  assert.equal(requestPathname("/%2e%2e/private?ignored=1"), "/%2e%2e/private");
  assert.equal(requestPathname("https://example.invalid/private"), null);
});

test("local acceptance preserves a null body for bodyless extension disconnect", () => {
  assert.equal(requestCarriesBody("DELETE", {}), false);
  assert.equal(requestCarriesBody("DELETE", { "content-length": "0" }), false);
  assert.equal(requestCarriesBody("DELETE", { "content-length": "2" }), true);
  assert.equal(requestCarriesBody("POST", { "transfer-encoding": "chunked" }), true);
  assert.equal(requestCarriesBody("GET", { "content-length": "2" }), false);
  assert.equal(requestCarriesBody("HEAD", { "transfer-encoding": "chunked" }), false);
});

test("local acceptance closes every server after a partial listen failure", async () => {
  const endpoints = [
    { host: "127.0.0.1", port: 8443, server: { id: 1 } },
    { host: "::1", port: 8443, server: { id: 2 } },
    { host: "127.0.0.1", port: 8444, server: { id: 3 } },
  ];
  const closed = [];

  await assert.rejects(
    listenServers(
      endpoints,
      async (server) => {
        if (server.id === 2) throw new Error("port in use");
      },
      async (server) => {
        closed.push(server.id);
      },
    ),
    /port in use/u,
  );
  assert.deepEqual(closed.sort(), [1, 2, 3]);
});

test("local acceptance waits for every pending listen before failure cleanup", async () => {
  const endpoints = [
    { host: "127.0.0.1", port: 8443, server: { id: 1 } },
    { host: "::1", port: 8443, server: { id: 2 } },
    { host: "127.0.0.1", port: 8444, server: { id: 3 } },
  ];
  const closed = [];
  let finishPendingListen;
  const pendingListen = new Promise((resolvePending) => {
    finishPendingListen = resolvePending;
  });
  const rejected = assert.rejects(
    listenServers(
      endpoints,
      async (server) => {
        if (server.id === 2) throw new Error("port in use");
        if (server.id === 3) await pendingListen;
      },
      async (server) => {
        closed.push(server.id);
      },
    ),
    /port in use/u,
  );

  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  try {
    assert.deepEqual(closed, []);
  } finally {
    assert.equal(typeof finishPendingListen, "function");
    finishPendingListen();
  }
  await rejected;
  assert.deepEqual(closed.sort(), [1, 2, 3]);
});

test("local acceptance pins one immutable Web bundle snapshot until HTTPS restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "huayi-acceptance-web-snapshot-"));
  try {
    await writeFile(join(root, "index.html"), "old-index", "utf8");
    const snapshot = await loadWebBundleSnapshot(root);

    await writeFile(join(root, "index.html"), "new-index", "utf8");

    assert.equal(snapshot.lookup("/app")?.body.toString("utf8"), "old-index");
    assert.equal(snapshot.lookup("/")?.body.toString("utf8"), "old-index");
    assert.equal(snapshot.lookup("/../../private"), null);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local acceptance refuses to start from an incomplete Web bundle snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "huayi-acceptance-web-incomplete-"));
  try {
    await assert.rejects(loadWebBundleSnapshot(root), /Web bundle is incomplete/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
