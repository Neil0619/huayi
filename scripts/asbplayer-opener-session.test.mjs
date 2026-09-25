import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { startMediaOpener } from "./asbplayer-opener-server.mjs";

test("repeat launches reuse the running opener; restarting retains origin and rotates its token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-opener-session-"));
  const options = {
    identityPath: join(directory, "browser-origin.json"),
    pickFile: async () => null,
    prepare: async () => {
      throw new Error("not used");
    },
    sidecars: async () => [],
  };
  let first, second, restarted;
  try {
    first = await startMediaOpener(options);
    second = await startMediaOpener(options);
    assert.equal(second.origin, first.origin);
    assert.equal(second.reused, true);
    await second.close();
    assert.equal(
      (
        await fetch(first.origin + "/api/state", {
          headers: { Authorization: `Bearer ${second.token}` },
        })
      ).status,
      200,
    );
    await first.close();
    restarted = await startMediaOpener(options);
    assert.equal(restarted.origin, first.origin);
    assert.notEqual(restarted.token, first.token);
    assert.equal(
      (
        await fetch(restarted.origin + "/api/state", {
          headers: { Authorization: `Bearer ${first.token}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(restarted.origin + "/api/state", {
          headers: { Authorization: `Bearer ${restarted.token}` },
        })
      ).status,
      200,
    );
  } finally {
    await second?.close();
    await first?.close();
    await restarted?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an untrusted port occupant never receives a bearer token and oversized proofs stop immediately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-opener-imposter-"));
  const options = {
    identityPath: join(directory, "browser-origin.json"),
    pickFile: async () => null,
    prepare: async () => undefined,
    sidecars: async () => [],
  };
  let first, occupant;
  const requests = [];
  try {
    first = await startMediaOpener(options);
    await first.close();
    occupant = createServer((request, response) => {
      requests.push({ authorization: request.headers.authorization, url: request.url });
      response.writeHead(200, { "Content-Type": "application/json" });
      // Deliberately do not finish: a bounded proof reader must reject the first oversized chunk.
      response.write("x".repeat(1024));
    });
    await new Promise((resolve) =>
      occupant.listen(Number(new URL(first.origin).port), "127.0.0.1", resolve),
    );
    await assert.rejects(startMediaOpener(options), /身份验证失败/u);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authorization, undefined);
    assert.match(requests[0].url, /^\/api\/session\?challenge=[a-f0-9]{64}$/u);
    assert.ok(!requests[0].url.includes(first.token));
  } finally {
    occupant?.closeAllConnections();
    if (occupant) await new Promise((resolve) => occupant.close(resolve));
    await first?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
