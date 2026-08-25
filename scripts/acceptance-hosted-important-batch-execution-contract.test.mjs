import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  assertFixedLocalDockerTarget,
  fixedDockerRunArguments,
  hostedImportantBatchPostgresRuntimeReference,
  runHostedImportantBatchProcess,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";

const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const posixProcessEnvironmentTest = process.platform === "win32" ? test.skip : test;

test("execution contract accepts only fixed local Unix Docker shapes", () => {
  assert.doesNotThrow(() => assertFixedLocalDockerTarget(dockerTarget));
  assert.doesNotThrow(() =>
    assertFixedLocalDockerTarget({
      command: "/usr/bin/docker",
      host: "unix:///var/run/docker.sock",
    }),
  );
  for (const target of [
    { command: "docker", host: dockerTarget.host },
    { command: dockerTarget.command, host: "tcp://private.example.test:2376" },
    { command: dockerTarget.command, host: "unix:///tmp/docker.sock" },
  ]) {
    assert.throws(() => assertFixedLocalDockerTarget(target));
  }
});

test("digest-only Docker run prefix forbids tag and implicit pull", () => {
  const arguments_ = fixedDockerRunArguments(dockerTarget, ["--network", "none"]);
  assert.deepEqual(arguments_.slice(0, 6), [
    "--host",
    dockerTarget.host,
    "run",
    "--rm",
    "--pull",
    "never",
  ]);
  assert.equal(arguments_.at(-1), hostedImportantBatchPostgresRuntimeReference);
  assert.equal(
    arguments_.some((value) => /supabase\/postgres:/u.test(value)),
    false,
  );
});

test("sensitive process adapter passes only the fixed child environment to spawn", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => true;
  let observed;
  const resultPromise = runHostedImportantBatchProcess("fixed-command", [], {
    spawnProcess: (command, arguments_, options) => {
      observed = { arguments_, command, options };
      return child;
    },
  });
  assert.deepEqual(observed.options.env, { LANG: "C", LC_ALL: "C" });
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.windowsHide, true);
  child.stdout.end("stage passed\n");
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0, stdout: "stage passed\n" });
});

posixProcessEnvironmentTest("real child inherits no unreviewed POSIX environment", async () => {
  const environmentResult = await runHostedImportantBatchProcess(process.execPath, [
    "--input-type=module",
    "--eval",
    "process.stdout.write(JSON.stringify(process.env))",
  ]);
  assert.equal(environmentResult.code, 0);
  const childEnvironment = JSON.parse(environmentResult.stdout);
  assert.equal(childEnvironment.LANG, "C");
  assert.equal(childEnvironment.LC_ALL, "C");
  assert.deepEqual(
    Object.keys(childEnvironment)
      .filter((name) => name !== "__CF_USER_TEXT_ENCODING")
      .sort(),
    ["LANG", "LC_ALL"],
  );
});

test("sensitive process adapter suppresses bounded-output overflow", async () => {
  const overflow = await runHostedImportantBatchProcess(
    process.execPath,
    ["--input-type=module", "--eval", "process.stdout.write('x'.repeat(1024))"],
    { maxOutputBytes: 8 },
  );
  assert.deepEqual(overflow, { code: null, stdout: "" });
});

test("timed-out process waits for the killed client to close before reporting completion", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
    return true;
  };
  let resolved = false;
  const resultPromise = runHostedImportantBatchProcess("fixed-command", [], {
    spawnProcess: () => child,
    timeoutMilliseconds: 1,
  }).then((result) => {
    resolved = true;
    return result;
  });

  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  assert.equal(killed, true);
  assert.equal(resolved, false);
  child.emit("close", null, "SIGKILL");
  assert.deepEqual(await resultPromise, { code: null, stdout: "" });
});

test("container settle accepts only exact known absent inspect results", async () => {
  for (const absent of [
    { code: 1, stdout: "" },
    { code: 1, stdout: "\n" },
    { code: 1, stdout: "[]\n" },
  ]) {
    let calls = 0;
    assert.equal(
      await settleHostedImportantBatchContainer({
        dockerTarget,
        name: "fixed-container",
        runProcess: async () => {
          calls += 1;
          return absent;
        },
        runtimeIsExact: () => false,
        wait: async () => undefined,
      }),
      true,
    );
    assert.equal(calls, 1);
  }

  for (const rejected of [
    { code: 1, stdout: "[]" },
    { code: 1, stdout: " \n" },
    { code: 1, stdout: "{}\n" },
    { code: 1, stdout: "private text\n" },
    { code: 0, stdout: "[]\n" },
  ]) {
    assert.equal(
      await settleHostedImportantBatchContainer({
        dockerTarget,
        name: "fixed-container",
        runProcess: async () => rejected,
        runtimeIsExact: () => false,
        wait: async () => undefined,
      }),
      false,
    );
  }

  let removed = false;
  assert.equal(
    await settleHostedImportantBatchContainer({
      dockerTarget,
      name: "fixed-container",
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "rm") {
          removed = true;
          return { code: 0, stdout: "fixed-container\n" };
        }
        return removed ? { code: 1, stdout: "[]\n" } : { code: 0, stdout: "exact-runtime" };
      },
      runtimeIsExact: (source) => source === "exact-runtime",
      wait: async () => undefined,
    }),
    true,
  );
  assert.equal(removed, true);
});
