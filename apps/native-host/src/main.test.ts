import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { runNativeHost, type RequestDispatcher } from "./main.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";

class HealthDispatcher implements RequestDispatcher {
  dispatch(_message: unknown, emit: (event: HostEvent) => void): void {
    emit({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.1.0",
      ready: true,
      requestId: "health-1",
      schemaVersion: 1,
      type: "health-result",
    });
  }
}

describe("runNativeHost", () => {
  it("writes only framed protocol data to stdout", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    errorOutput.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    const stop = runNativeHost({
      dispatcher: new HealthDispatcher(),
      errorOutput,
      input,
      output,
    });

    input.write(encodeNativeMessage({ requestId: "health-1", schemaVersion: 1, type: "health" }));
    await vi.waitFor(() => expect(outputChunks.length).toBe(1));

    const decoder = new NativeMessageDecoder();
    expect(decoder.push(Buffer.concat(outputChunks))).toEqual([
      {
        codexVersion: "codex-cli 0.144.1",
        hostVersion: "0.1.0",
        ready: true,
        requestId: "health-1",
        schemaVersion: 1,
        type: "health-result",
      },
    ]);
    expect(Buffer.concat(errorChunks).toString("utf8")).toBe("");
    stop();
  });

  it("writes framing failures only to stderr and stops reading", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    errorOutput.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    runNativeHost({
      dispatcher: new HealthDispatcher(),
      errorOutput,
      input,
      output,
    });

    input.write(Buffer.alloc(4));
    await vi.waitFor(() => expect(errorChunks.length).toBe(1));

    expect(outputChunks).toEqual([]);
    expect(Buffer.concat(errorChunks).toString("utf8")).toContain("Native host protocol error");
  });
});
