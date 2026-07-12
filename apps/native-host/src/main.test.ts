import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import {
  createNativeHostDispatcher,
  readNativeHostConfiguration,
  runNativeHost,
  type RequestDispatcher,
} from "./main.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";
import { APP_SERVER_DISABLED_FEATURES } from "./runtime/codex-app-server-config.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "./runtime/codex-process.js";
import type { EudicFetch } from "./wordbook/eudic-client.js";

class HealthDispatcher implements RequestDispatcher {
  dispatch(_message: unknown, emit: (event: HostEvent) => void): void {
    emit({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.3.0",
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
        hostVersion: "0.3.0",
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

describe("native host bootstrap", () => {
  it("requires absolute installer-owned runtime paths", () => {
    expect(() => readNativeHostConfiguration({ HUAYI_CODEX_PATH: "/opt/codex" })).toThrow(
      /HUAYI_WORK_DIR/,
    );
    expect(() =>
      readNativeHostConfiguration({
        HUAYI_CODEX_PATH: "codex",
        HUAYI_SCHEMA_DIR: "/tmp/schemas",
        HUAYI_WORK_DIR: "/tmp/work",
      }),
    ).toThrow(/absolute/);
  });

  it("wires health checks to capability detection without invoking an analysis", async () => {
    const results: ProcessRunResult[] = [
      { exitCode: 0, signal: null, stderr: "", stdout: "codex-cli 0.144.1" },
      {
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout: ["--stdio", "--strict-config", "--disable", "--config"].join("\n"),
      },
      {
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout: APP_SERVER_DISABLED_FEATURES.map((feature) => `${feature} stable false`).join("\n"),
      },
      { exitCode: 0, signal: null, stderr: "", stdout: "Logged in using ChatGPT" },
    ];
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        const result = results.shift();
        if (result === undefined) {
          throw new Error("Missing fake result.");
        }
        return result;
      },
    };
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      processRunner,
      schemaDirectory: "/tmp/schemas",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch({ requestId: "health-2", schemaVersion: 1, type: "health" }, (event) =>
      events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.3.0",
      ready: true,
    });
    expect(requests.map((request) => request.arguments)).toEqual([
      ["--version"],
      ["app-server", "--help"],
      [
        "features",
        "list",
        ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      ],
      ["login", "status"],
    ]);
    dispatcher.dispose();
  });

  it("wires add-word requests through Keychain authorization and the fixed Eudic client", async () => {
    const processRequests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        processRequests.push(request);
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: "Bearer configured-secret\n",
        };
      },
    };
    const fetchRequests: Parameters<EudicFetch>[] = [];
    const eudicFetch: EudicFetch = async (...arguments_) => {
      fetchRequests.push(arguments_);
      return new Response(JSON.stringify({ data: [{ word: "investigation" }] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    };
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      eudicFetch,
      processRunner,
      schemaDirectory: "/tmp/schemas",
      securityExecutable: "/usr/bin/security",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch(
      {
        context: "The investigation is still in its early stages.",
        language: "en",
        requestId: "word-1",
        schemaVersion: 1,
        type: "add-word",
        word: "investigation",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === "word-added")).toBe(true));

    expect(events.at(-1)).toEqual({
      outcome: "already-exists",
      requestId: "word-1",
      schemaVersion: 1,
      type: "word-added",
    });
    expect(processRequests).toHaveLength(1);
    expect(processRequests[0]?.arguments).toEqual([
      "find-generic-password",
      "-s",
      "com.huayi.codex_bridge.eudic",
      "-a",
      "authorization",
      "-w",
    ]);
    expect(fetchRequests).toHaveLength(1);
    expect(fetchRequests[0]?.[1].headers.Authorization).toBe("Bearer configured-secret");
    dispatcher.dispose();
  });

  it("wires check-word requests through Keychain authorization and the fixed Eudic client", async () => {
    const processRequests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        processRequests.push(request);
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: "Bearer configured-secret\n",
        };
      },
    };
    const fetchRequests: Parameters<EudicFetch>[] = [];
    const eudicFetch: EudicFetch = async (...arguments_) => {
      fetchRequests.push(arguments_);
      return new Response(JSON.stringify({ data: [{ word: "investigation" }] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    };
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      eudicFetch,
      processRunner,
      schemaDirectory: "/tmp/schemas",
      securityExecutable: "/usr/bin/security",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch(
      {
        language: "en",
        requestId: "check-1",
        schemaVersion: 1,
        type: "check-word",
        word: "investigation",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === "word-status")).toBe(true));

    expect(events.at(-1)).toEqual({
      presence: "present",
      requestId: "check-1",
      schemaVersion: 1,
      type: "word-status",
    });
    expect(processRequests).toHaveLength(1);
    expect(fetchRequests).toHaveLength(1);
    expect(fetchRequests[0]?.[1].method).toBe("GET");
    dispatcher.dispose();
  });
});
