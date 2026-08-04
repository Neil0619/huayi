import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  encodeNativeMessage,
  verifyIsolatedNativeHostExecutable,
  verifyNativeHostExecutable,
} from "./verify-windows-sea.mjs";

const requestId = "verify-windows-sea-health";

function fixtureScript({ delay = false, stderr = "", trailing = false } = {}) {
  const response = JSON.stringify({
    codexVersion: null,
    hostVersion: "0.12.0",
    model: "deepseek-v4-flash",
    provider: "deepseek-chat-completions",
    ready: true,
    requestId,
    schemaVersion: 6,
    type: "health-result",
  });
  return `
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {});
    process.stdin.once("data", () => {
      ${delay ? "setTimeout(() => {}, 10_000); return;" : ""}
      const payload = Buffer.from(${JSON.stringify(response)}, "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length, 0);
      ${stderr.length > 0 ? `process.stderr.write(${JSON.stringify(stderr)});` : ""}
      process.stdout.write(Buffer.concat([header, payload${trailing ? ', Buffer.from("x")' : ""}]));
    });
  `;
}

function verifyFixture(options = {}) {
  return verifyNativeHostExecutable({
    arguments: ["-e", fixtureScript(options)],
    executable: process.execPath,
    spawnProcess: spawn,
    timeoutMs: options.timeoutMs ?? 1_000,
  });
}

test("encodes the fixed health request as one native message", () => {
  const frame = encodeNativeMessage({ requestId, schemaVersion: 6, type: "health" });
  assert.equal(frame.readUInt32LE(0), frame.length - 4);
  assert.deepEqual(JSON.parse(frame.subarray(4).toString("utf8")), {
    requestId,
    schemaVersion: 6,
    type: "health",
  });
});

test("accepts an exact Windows DeepSeek SEA health exchange", async () => {
  await assert.doesNotReject(verifyFixture());
});

test("copies the packaged SEA outside the repository and removes Node module lookup paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huayi-sea-source-"));
  const sourceExecutable = join(directory, "huayi-native-host.exe");
  await writeFile(sourceExecutable, "fake SEA", "utf8");
  let isolatedDirectory;
  try {
    await verifyIsolatedNativeHostExecutable({
      environment: { LOCALAPPDATA: "C:\\real", NODE_PATH: "C:\\repo\\node_modules" },
      sourceExecutable,
      verifyExecutable: async ({ cwd, env, executable }) => {
        isolatedDirectory = cwd;
        assert.equal(dirname(executable), cwd);
        assert.notEqual(resolve(cwd), resolve(directory));
        assert.equal(await readFile(executable, "utf8"), "fake SEA");
        assert.equal(env.NODE_PATH, undefined);
        assert.equal(env.LOCALAPPDATA, join(cwd, "local-app-data"));
      },
    });
    await assert.rejects(readFile(isolatedDirectory), (error) => error?.code === "ENOENT");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects stdout bytes after the health frame", async () => {
  await assert.rejects(verifyFixture({ trailing: true }), /stdout/i);
});

test("rejects any stderr contamination", async () => {
  await assert.rejects(verifyFixture({ stderr: "unexpected" }), /stderr/i);
});

test("kills and rejects an unresponsive executable", async () => {
  await assert.rejects(verifyFixture({ delay: true, timeoutMs: 20 }), /timed out/i);
});
