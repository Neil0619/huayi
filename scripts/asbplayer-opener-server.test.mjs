import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { startMediaOpener } from "./asbplayer-opener-server.mjs";

test("loopback requires session token and exact Origin/Host, rejects supplied paths, serves only selected media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-opener-"));
  let opener;
  try {
    const file = join(directory, "video.mp4");
    await writeFile(file, "media-bytes");
    let picks = 0;
    opener = await startMediaOpener({
      pickFile: async () => {
        picks++;
        return file;
      },
      prepare: async () => ({
        files: [{ path: file, name: "video.mp4", kind: "video", type: "video/mp4", size: 11 }],
        plan: { imageSubtitleCount: 0 },
      }),
      sidecars: async () => [],
    });
    const headers = {
      Authorization: `Bearer ${opener.token}`,
      Origin: opener.origin,
      "Content-Type": "application/json",
    };
    assert.equal((await fetch(`${opener.origin}/api/state`)).status, 403);
    assert.equal(
      (
        await fetch(`${opener.origin}/api/open`, {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.test" },
          body: "{}",
        })
      ).status,
      403,
    );
    const wrongHostStatus = await new Promise((resolve, reject) => {
      const call = request(
        `${opener.origin}/api/open`,
        { method: "POST", headers: { ...headers, Host: "evil.test" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      call.on("error", reject);
      call.end("{}");
    });
    assert.equal(wrongHostStatus, 403);
    assert.equal(
      (
        await fetch(`${opener.origin}/api/open`, {
          method: "POST",
          headers,
          body: JSON.stringify({ path: "C:/private" }),
        })
      ).status,
      400,
    );
    assert.equal(picks, 0);
    assert.equal(
      (await fetch(`${opener.origin}/api/open`, { method: "POST", headers, body: "{}" })).status,
      202,
    );
    let state;
    for (let i = 0; i < 100; i++) {
      state = await (await fetch(`${opener.origin}/api/state`, { headers })).json();
      if (state.status === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.status, "ready");
    assert.equal(picks, 1);
    assert.ok(!JSON.stringify(state).includes(directory));
    assert.equal(
      await (await fetch(`${opener.origin}/file/${state.files[0].id}`, { headers })).text(),
      "media-bytes",
    );
    assert.equal((await fetch(`${opener.origin}/file/unknown`, { headers })).status, 404);
    assert.equal((await fetch(`${opener.origin}/file/../../private`, { headers })).status, 404);
    const page = await fetch(opener.origin);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.ok((await page.text()).includes("选择原视频"));
  } finally {
    await opener?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
