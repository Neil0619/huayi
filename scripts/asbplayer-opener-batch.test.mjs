import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMediaOpener } from "./asbplayer-opener-server.mjs";

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-batch-"));
  const sources = ["one.mp4", "broken.mp4", "two.mp4"].map((name) => join(directory, name));
  for (const source of sources) await writeFile(source, "video");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const prepared = [];
  let selection = sources;
  const opener = await startMediaOpener({
    pickFile: async () => sources[0],
    pickFiles: async () => selection,
    prepare: async (source, progress) => {
      prepared.push(source);
      progress("正在准备兼容音轨");
      if (prepared.length === 1) await gate;
      if (source === sources[1]) throw new Error("private diagnostic");
      return {
        files: [{ path: source, name: "video.mp4", kind: "video", type: "video/mp4", size: 5 }],
        plan: { imageSubtitleCount: 0 },
      };
    },
    sidecars: async () => [],
  });
  const headers = {
    Authorization: `Bearer ${opener.token}`,
    Origin: opener.origin,
    "Content-Type": "application/json",
  };
  const post = (path, body = "{}", extra = {}) =>
    fetch(`${opener.origin}${path}`, { method: "POST", headers: { ...headers, ...extra }, body });
  const state = async () => (await fetch(`${opener.origin}/api/state`, { headers })).json();
  const until = async (predicate) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = await state();
      if (predicate(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("batch did not reach the expected state");
  };
  try {
    await run({
      sources,
      prepared,
      post,
      state,
      until,
      release,
      select: (value) => {
        selection = value;
      },
    });
  } finally {
    release();
    await until((value) => !value.batch?.busy);
    await opener.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("batch prepares selected files serially, preserves per-file failures and selects a completed item", async () => {
  await fixture(async ({ sources, prepared, post, until, release, select }) => {
    select([...sources, sources[0]]);
    assert.equal((await post("/api/batch/start")).status, 202);
    const working = await until((value) => value.batch?.items[0]?.status === "preparing");
    assert.equal(working.batch.items.length, 3, "duplicate selections run once");
    assert.deepEqual(prepared, [sources[0]], "only one converter runs at a time");
    assert.equal((await post("/api/open")).status, 409);
    assert.equal((await post("/api/close")).status, 409);
    assert.equal((await post("/api/batch/start")).status, 409);
    release();
    const completed = await until((value) => !value.batch.busy);
    assert.deepEqual(
      completed.batch.items.map((item) => item.status),
      ["ready", "failed", "ready"],
    );
    assert.deepEqual(prepared, sources);
    assert.equal(JSON.stringify(completed).includes("private diagnostic"), false);
    assert.equal((await post(`/api/batch/select/${completed.batch.items[1].id}`)).status, 404);
    assert.equal((await post(`/api/batch/select/${completed.batch.items[2].id}`)).status, 202);
    const selected = await until((value) => value.status === "ready");
    assert.equal(selected.name, "two.mp4");
    assert.equal(selected.files[0].localName, "two.mp4");
    assert.equal(selected.batch.items.length, 3, "selection keeps the batch results");
  });
});

test("stopping a batch finishes the current file and skips the remaining files", async () => {
  await fixture(async ({ sources, prepared, post, until, release }) => {
    assert.equal((await post("/api/batch/start")).status, 202);
    await until((value) => value.batch?.items[0]?.status === "preparing");
    assert.equal((await post("/api/batch/stop")).status, 202);
    release();
    const done = await until((value) => !value.batch.busy);
    assert.deepEqual(
      done.batch.items.map((item) => item.status),
      ["ready", "skipped", "skipped"],
    );
    assert.deepEqual(prepared, [sources[0]]);
    assert.equal((await post(`/api/batch/select/${done.batch.items[0].id}`)).status, 202);
    await until((value) => value.status === "ready");
  });
});

test("batch cancellation keeps previous results; endpoints reject browser-supplied paths and origins", async () => {
  await fixture(async ({ post, until, release, select, prepared }) => {
    assert.equal(
      (await post("/api/batch/start", JSON.stringify({ paths: ["C:/private"] }))).status,
      400,
    );
    assert.equal(
      (await post("/api/batch/start", "{}", { Origin: "https://evil.test" })).status,
      403,
    );
    assert.equal((await post("/api/batch/select/unknown")).status, 404);
    assert.equal(prepared.length, 0);
    release();
    assert.equal((await post("/api/batch/start")).status, 202);
    const completed = await until(
      (value) => value.batch && !value.batch.busy && value.batch.items.length === 3,
    );
    select(null);
    assert.equal((await post("/api/batch/start")).status, 202);
    const cancelled = await until((value) => !value.batch.busy);
    assert.deepEqual(cancelled.batch.items, completed.batch.items);
  });
});
