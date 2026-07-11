import { EventEmitter, once } from "node:events";
import { endianness } from "node:os";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import test from "node:test";

import { NativeHostClient, encodeNativeMessage } from "./native-host-smoke-client.mjs";

const validHostEventSchema = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("requestId" in value) ||
      typeof value.requestId !== "string" ||
      !("type" in value) ||
      !["error", "health-result", "progress", "result"].includes(value.type)
    ) {
      throw new Error("Invalid host event schema.");
    }
    return value;
  },
};

class FakeChild extends EventEmitter {
  constructor({ exitDuringObservation = false, pid = 4_321 } = {}) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = pid;
    this.currentExitCode = null;
    this.currentSignalCode = null;
    this.exitDuringObservation = exitDuringObservation;
  }

  get exitCode() {
    if (this.exitDuringObservation) {
      this.exitDuringObservation = false;
      this.currentExitCode = 0;
      this.emit("exit", 0, null);
      return null;
    }
    return this.currentExitCode;
  }

  get signalCode() {
    return this.currentSignalCode;
  }

  completeExit(code = 0, signal = null) {
    this.currentExitCode = code;
    this.currentSignalCode = signal;
    this.emit("exit", code, signal);
  }
}

function encodeRawPayload(payload) {
  const header = Buffer.alloc(4);
  if (endianness() === "LE") {
    header.writeUInt32LE(payload.length, 0);
  } else {
    header.writeUInt32BE(payload.length, 0);
  }
  return Buffer.concat([header, payload]);
}

async function settleResult(client, child, requestId = "settled-request") {
  const result = client.request({ requestId }, "result", 1_000);
  child.stdout.write(
    encodeNativeMessage({
      requestId,
      result: {},
      type: "result",
    }),
  );
  await result;
}

async function endStdout(child) {
  if (child.stdout.readableEnded) {
    return;
  }
  const ended = once(child.stdout, "end");
  child.stdout.end();
  await ended;
}

function createClient(child, options = {}) {
  return new NativeHostClient(child, validHostEventSchema, {
    killProcess: () => false,
    processGroupExists: () => false,
    ...options,
  });
}

for (const [name, corruptOutput] of [
  [
    "extra event",
    async (child) => {
      child.stdout.write(
        encodeNativeMessage({ requestId: "settled-request", result: {}, type: "result" }),
      );
    },
  ],
  [
    "invalid schema",
    async (child) => {
      child.stdout.write(
        encodeNativeMessage({ requestId: "settled-request", type: "not-a-host-event" }),
      );
    },
  ],
  [
    "invalid JSON",
    async (child) => {
      child.stdout.write(encodeRawPayload(Buffer.from("{", "utf8")));
    },
  ],
  [
    "invalid frame",
    async (child) => {
      child.stdout.write(Buffer.alloc(4));
    },
  ],
  [
    "trailing bytes at EOF",
    async (child) => {
      const ended = once(child.stdout, "end");
      child.stdout.end(Buffer.from([1, 2, 3]));
      await ended;
    },
  ],
]) {
  test(`native host client latches ${name} after the request settles`, async () => {
    const child = new FakeChild();
    const client = createClient(child);
    await settleResult(client, child);

    await corruptOutput(child);

    let futureError;
    await assert.rejects(
      client.request({ requestId: "future-request" }, "result", 1_000),
      (error) => {
        futureError = error;
        return error instanceof Error;
      },
    );

    const closing = client.close();
    await endStdout(child);
    child.completeExit();
    await assert.rejects(closing, (error) => error === futureError);
  });
}

for (const streamName of ["stdin", "stderr"]) {
  test(`native host client latches ${streamName} stream errors`, async () => {
    const child = new FakeChild();
    const client = createClient(child);
    const streamError = new Error(`${streamName} failed`);

    child[streamName].emit("error", streamError);

    await assert.rejects(
      client.request({ requestId: "future-request" }, "result", 1_000),
      (error) => error === streamError,
    );
    const closing = client.close();
    await endStdout(child);
    child.completeExit();
    await assert.rejects(closing, (error) => error === streamError);
  });
}

test("close waits for both child exit and stdout EOF", async () => {
  const child = new FakeChild();
  const client = createClient(child, {
    gracefulCloseTimeoutMs: 100,
    killTimeoutMs: 100,
    terminateTimeoutMs: 100,
  });
  let settled = false;
  const closing = client.close().finally(() => {
    settled = true;
  });

  child.completeExit();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(settled, false);

  await endStdout(child);
  await closing;
  assert.equal(client.shutdownComplete, true);
});

test("close latches an exit observed before graceful shutdown starts", async () => {
  const child = new FakeChild({ exitDuringObservation: true });
  const signals = [];
  const client = createClient(child, {
    gracefulCloseTimeoutMs: 10,
    killProcess: (pid, signal) => signals.push([pid, signal]),
    killTimeoutMs: 10,
    terminateTimeoutMs: 10,
  });
  await endStdout(child);

  await assert.rejects(client.close(), /before graceful shutdown/i);

  assert.deepEqual(signals, [[child.pid, "SIGTERM"]]);
});

test("a nonzero exit after the final result is fatal", async () => {
  const child = new FakeChild();
  const signals = [];
  const client = createClient(child, {
    detachedProcessGroup: true,
    gracefulCloseTimeoutMs: 5,
    killProcess: (pid, signal) => signals.push([pid, signal]),
    killTimeoutMs: 20,
    terminateTimeoutMs: 5,
  });
  await settleResult(client, child);
  const closing = client.close();
  await endStdout(child);
  child.completeExit(1);

  let exitError;
  await assert.rejects(closing, (error) => {
    exitError = error;
    return error instanceof Error && /unexpectedly.*1/i.test(error.message);
  });
  await assert.rejects(
    client.request({ requestId: "future-request" }, "result", 1_000),
    (error) => error === exitError,
  );
  assert.deepEqual(signals, [[-child.pid, "SIGTERM"]]);
  assert.equal(client.shutdownComplete, true);
});

test("fatal shutdown waits for a lingering detached process group to disappear", async () => {
  const child = new FakeChild();
  const probes = [];
  const signals = [];
  let groupAlive = true;
  const client = createClient(child, {
    detachedProcessGroup: true,
    gracefulCloseTimeoutMs: 5,
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL") {
        groupAlive = false;
      }
    },
    killTimeoutMs: 20,
    processGroupExists: (pid) => {
      probes.push(pid);
      return groupAlive;
    },
    terminateTimeoutMs: 5,
  });
  await settleResult(client, child);
  child.stdout.write(
    encodeNativeMessage({ requestId: "settled-request", result: {}, type: "result" }),
  );
  let fatalError;
  await assert.rejects(
    client.request({ requestId: "future-request" }, "result", 1_000),
    (error) => {
      fatalError = error;
      return error instanceof Error;
    },
  );
  await endStdout(child);
  child.completeExit();

  await assert.rejects(client.close(), (error) => error === fatalError);

  assert.deepEqual(signals, [
    [-child.pid, "SIGTERM"],
    [-child.pid, "SIGKILL"],
  ]);
  assert.ok(probes.length > 0);
  assert.ok(probes.every((pid) => pid === -child.pid));
  assert.equal(client.shutdownComplete, true);
});

test("bounded close escalates SIGTERM then SIGKILL to the detached process group", async () => {
  const child = new FakeChild();
  const signals = [];
  const client = createClient(child, {
    detachedProcessGroup: true,
    gracefulCloseTimeoutMs: 10,
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL") {
        child.stdout.end();
        child.completeExit(null, signal);
      }
    },
    killTimeoutMs: 50,
    terminateTimeoutMs: 10,
  });

  await client.close();

  assert.deepEqual(signals, [
    [-child.pid, "SIGTERM"],
    [-child.pid, "SIGKILL"],
  ]);
});

test("a signal attempt does not excuse a signal-less nonzero exit", async () => {
  const child = new FakeChild();
  const signals = [];
  let groupAlive = true;
  const client = createClient(child, {
    detachedProcessGroup: true,
    gracefulCloseTimeoutMs: 5,
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      groupAlive = false;
      child.stdout.end();
      child.completeExit(1);
    },
    processGroupExists: () => groupAlive,
    terminateTimeoutMs: 20,
  });

  let exitError;
  await assert.rejects(client.close(), (error) => {
    exitError = error;
    return error instanceof Error && /unexpectedly.*1/i.test(error.message);
  });
  await assert.rejects(
    client.request({ requestId: "future-request" }, "result", 1_000),
    (error) => error === exitError,
  );
  assert.deepEqual(signals, [[-child.pid, "SIGTERM"]]);
});

test("close rejects within its final bound when the child never exits", async () => {
  const child = new FakeChild();
  const signals = [];
  const client = createClient(child, {
    detachedProcessGroup: true,
    gracefulCloseTimeoutMs: 5,
    killProcess: (pid, signal) => signals.push([pid, signal]),
    killTimeoutMs: 5,
    terminateTimeoutMs: 5,
  });

  await assert.rejects(client.close(), /did not exit and close stdout/i);
  assert.deepEqual(signals, [
    [-child.pid, "SIGTERM"],
    [-child.pid, "SIGKILL"],
  ]);
  assert.equal(client.shutdownComplete, false);

  child.stdout.end();
  child.completeExit(null, "SIGKILL");
});

test("close preserves the first fatal error when bounded shutdown is incomplete", async () => {
  const child = new FakeChild();
  const client = createClient(child, {
    detachedProcessGroup: true,
    gracefulCloseTimeoutMs: 5,
    killProcess: () => false,
    killTimeoutMs: 5,
    terminateTimeoutMs: 5,
  });
  await settleResult(client, child);
  child.stdout.write(
    encodeNativeMessage({ requestId: "settled-request", result: {}, type: "result" }),
  );

  let fatalError;
  await assert.rejects(
    client.request({ requestId: "future-request" }, "result", 1_000),
    (error) => {
      fatalError = error;
      return error instanceof Error;
    },
  );

  await assert.rejects(client.close(), (error) => error === fatalError);
  assert.equal(client.shutdownComplete, false);

  child.stdout.end();
  child.completeExit(null, "SIGKILL");
});
