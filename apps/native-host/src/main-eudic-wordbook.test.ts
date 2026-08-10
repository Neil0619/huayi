import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { createNativeHostDispatcher } from "./main.js";
import type { ProcessRunRequest, ProcessRunner } from "./runtime/codex-process.js";
import type { EudicFetch } from "./wordbook/eudic-client.js";

describe("native host Eudic wordbook bootstrap", () => {
  it("wires add-word requests through Keychain authorization and the fixed Eudic client", async () => {
    const processRequests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        processRequests.push(request);
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: "Bearer fixture\n",
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
      errorOutput: new PassThrough(),
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
        schemaVersion: 7,
        type: "add-word",
        word: "investigation",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === "word-added")).toBe(true));

    expect(events.at(-1)).toEqual({
      outcome: "already-exists",
      requestId: "word-1",
      schemaVersion: 7,
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
    expect(processRequests.some((request) => request.arguments[0] === "mcp")).toBe(false);
    expect(fetchRequests).toHaveLength(1);
    expect(fetchRequests[0]?.[1].headers.Authorization).toBe("Bearer fixture");
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
          stdout: "Bearer fixture\n",
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
      errorOutput: new PassThrough(),
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
        schemaVersion: 7,
        type: "check-word",
        word: "investigation",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === "word-status")).toBe(true));

    expect(events.at(-1)).toEqual({
      presence: "present",
      requestId: "check-1",
      schemaVersion: 7,
      type: "word-status",
    });
    expect(processRequests).toHaveLength(1);
    expect(processRequests.some((request) => request.arguments[0] === "mcp")).toBe(false);
    expect(fetchRequests).toHaveLength(1);
    expect(fetchRequests[0]?.[1].method).toBe("GET");
    dispatcher.dispose();
  });
});
