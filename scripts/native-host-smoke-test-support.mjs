import { EventEmitter, once } from "node:events";
import { endianness } from "node:os";
import { PassThrough } from "node:stream";

import { NativeHostClient, encodeNativeMessage } from "./native-host-smoke-client.mjs";

const validHostEventSchema = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("requestId" in value) ||
      typeof value.requestId !== "string" ||
      !("type" in value) ||
      ![
        "analysis-delta",
        "error",
        "health-result",
        "progress",
        "result",
        "word-added",
        "word-status",
      ].includes(value.type)
    ) {
      throw new Error("Invalid host event schema.");
    }
    return value;
  },
};

export class FakeChild extends EventEmitter {
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

export function encodeRawPayload(payload) {
  const header = Buffer.alloc(4);
  if (endianness() === "LE") {
    header.writeUInt32LE(payload.length, 0);
  } else {
    header.writeUInt32BE(payload.length, 0);
  }
  return Buffer.concat([header, payload]);
}

export async function settleResult(client, child, requestId = "settled-request") {
  const result = client.request({ requestId }, "result", 1_000);
  child.stdout.write(encodeNativeMessage({ requestId, result: {}, type: "result" }));
  await result;
}

export async function endStdout(child) {
  if (child.stdout.readableEnded) {
    return;
  }
  const ended = once(child.stdout, "end");
  child.stdout.end();
  await ended;
}

export function createClient(child, options = {}) {
  return new NativeHostClient(child, validHostEventSchema, {
    killProcess: () => false,
    processGroupExists: () => false,
    ...options,
  });
}

export async function closeClient(client, child) {
  const closing = client.close();
  await endStdout(child);
  child.completeExit();
  await closing;
}
