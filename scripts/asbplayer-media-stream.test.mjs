import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as streams from "./asbplayer-media-stream.mjs";

test("concurrent readers cannot exceed the active response limit during asynchronous file opens", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "seen-said-stream-limit-")));
  const registry = streams.createMediaStreams();
  const clients = [];
  let server;
  try {
    const path = join(directory, "large.mp4");
    const file = await open(path, "w");
    await file.truncate(64 * 1024 * 1024);
    await file.close();
    const capability = await registry.publish(path);
    let origin;
    server = createServer(async (req, res) => {
      if (!(await registry.serve(req, res, origin))) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const statuses = await Promise.all(
      Array.from(
        { length: 24 },
        () =>
          new Promise((resolve, reject) => {
            const client = request(origin + capability, { agent: false }, (response) => {
              // Keep successful streams backpressured until every simultaneous header arrives.
              resolve(response.statusCode);
            });
            clients.push(client);
            client.on("error", reject);
            client.end();
          }),
      ),
    );
    assert.equal(statuses.filter((status) => status === 200).length, 16);
    assert.equal(statuses.filter((status) => status === 429).length, 8);
  } finally {
    for (const client of clients) client.destroy();
    registry.clear();
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("only selected capabilities serve bounded ranges; origins, methods, changes and eviction fail closed", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "seen-said-stream-")));
  let server;
  try {
    const registry = streams.createMediaStreams();
    const path = join(directory, "cached.mp4");
    await writeFile(path, "0123456789abcdef");
    const capability = await registry.publish(path);
    let origin;
    server = createServer(async (req, res) => {
      if (!(await registry.serve(req, res, origin))) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const url = origin + capability;
    const headers = { Origin: "https://app.asbplayer.dev", Range: "bytes=3-7" };
    const part = await fetch(url, { headers });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 3-7/16");
    assert.equal(part.headers.get("content-length"), "5");
    assert.equal(part.headers.get("access-control-allow-origin"), "https://app.asbplayer.dev");
    assert.equal(part.headers.get("cache-control"), "no-store");
    assert.equal(await part.text(), "34567");
    const suffix = await fetch(url, { headers: { ...headers, Range: "bytes=-4" } });
    assert.equal(await suffix.text(), "cdef");
    const head = await fetch(url, { method: "HEAD", headers: { Origin: headers.Origin } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "16");
    assert.equal(await head.text(), "");
    assert.equal(
      (await fetch(url, { headers: { ...headers, Origin: "https://evil.test" } })).status,
      403,
    );
    assert.equal((await fetch(url + "?file=private", { headers })).status, 404);
    assert.equal((await fetch(origin + "/stream/unknown", { headers })).status, 404);
    assert.equal((await fetch(url, { method: "POST", headers })).status, 405);
    for (const Range of ["bytes=16-", "bytes=7-3", "bytes=0-1,4-5", "bytes=-0", "items=0-1"])
      assert.equal((await fetch(url, { headers: { ...headers, Range } })).status, 416);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(url, { headers: { ...headers, Host: "evil.test" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(wrongHost, 403);
    await writeFile(path, "changed-cache");
    assert.equal((await fetch(url, { headers })).status, 410);
    const previous = await registry.publish(path);
    for (let i = 0; i < 4; i++) await registry.publish(path);
    assert.equal((await fetch(origin + previous, { headers })).status, 410);
    registry.clear();
  } finally {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
