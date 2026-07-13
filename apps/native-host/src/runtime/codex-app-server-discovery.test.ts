import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexAppServerClient } from "./codex-app-server.js";
import type { JsonRpcProcess } from "./json-rpc-channel.js";

interface RpcMessage {
  id?: number;
  method: string;
  params?: unknown;
}

class FakeAppServerProcess extends EventEmitter implements JsonRpcProcess {
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly messages: RpcMessage[] = [];
  readonly #taken = new Set<number>();

  constructor() {
    super();
    let input = "";
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      input += chunk;
      const lines = input.split("\n");
      input = lines.pop() ?? "";
      for (const line of lines) this.messages.push(JSON.parse(line) as RpcMessage);
    });
  }

  kill(): boolean {
    return true;
  }

  async takeRequest(method: string): Promise<RpcMessage> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const request = this.messages.find(
        (message) =>
          message.method === method && message.id !== undefined && !this.#taken.has(message.id),
      );
      if (request?.id !== undefined) {
        this.#taken.add(request.id);
        return request;
      }
      await Promise.resolve();
    }
    throw new Error(`Missing ${method} request.`);
  }
}

interface Observation {
  rejection: unknown | undefined;
  resolution: string | undefined;
}

const clients = new Set<CodexAppServerClient>();

function observe(promise: Promise<string>): Observation {
  const observation: Observation = { rejection: undefined, resolution: undefined };
  void promise.then(
    (value) => {
      observation.resolution = value;
    },
    (error: unknown) => {
      observation.rejection = error;
    },
  );
  return observation;
}

function run(
  client: CodexAppServerClient,
  requestId: string,
  controller: AbortController,
): Promise<string> {
  return client.runTurn({
    onAssistantDelta: () => undefined,
    outputSchema: {},
    prompt: "untrusted text",
    requestId,
    signal: controller.signal,
  });
}

afterEach(() => {
  for (const client of clients) client.dispose();
  clients.clear();
});

describe("CodexAppServerClient MCP discovery startup", () => {
  it("discovers MCP servers before creating App Server", async () => {
    let resolveDiscovery: (names: readonly string[]) => void = () => undefined;
    const discovery = new Promise<readonly string[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const process = new FakeAppServerProcess();
    const processFactory = vi.fn(() => process);
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery: () => discovery,
      processFactory,
      workingDirectory: "/tmp/huayi-empty",
    });
    clients.add(client);
    const observation = observe(run(client, "discovery-order", new AbortController()));

    await Promise.resolve();
    expect(processFactory).not.toHaveBeenCalled();
    resolveDiscovery(["node_repl"]);
    await process.takeRequest("initialize");
    expect(processFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServerNamesToDisable: ["node_repl"],
      }),
    );
    client.dispose();
    await vi.waitFor(() =>
      expect(observation.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" })),
    );
  });

  it("maps MCP discovery rejection to a capability failure before process creation", async () => {
    const processFactory = vi.fn(() => {
      throw new Error("process creation must stay unreachable");
    });
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery: async () => {
        throw new Error("untrusted discovery diagnostics");
      },
      processFactory,
      workingDirectory: "/tmp/huayi-empty",
    });
    clients.add(client);

    await expect(run(client, "discovery-failure", new AbortController())).rejects.toMatchObject({
      code: "CODEX_CAPABILITY_MISSING",
      retryable: false,
    });
    expect(processFactory).not.toHaveBeenCalled();
  });

  it("shares one MCP discovery across concurrent turns during startup", async () => {
    let resolveDiscovery: (names: readonly string[]) => void = () => undefined;
    const discoveryResult = new Promise<readonly string[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const mcpServerDiscovery = vi.fn(() => discoveryResult);
    const process = new FakeAppServerProcess();
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery,
      processFactory: () => process,
      workingDirectory: "/tmp/huayi-empty",
    });
    clients.add(client);
    const first = observe(run(client, "discovery-first", new AbortController()));
    const second = observe(run(client, "discovery-second", new AbortController()));

    await Promise.resolve();
    expect(mcpServerDiscovery).toHaveBeenCalledTimes(1);
    resolveDiscovery([]);
    await process.takeRequest("initialize");
    client.dispose();
    await vi.waitFor(() => {
      expect(first.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
      expect(second.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
    });
  });

  it("does not create App Server after the sole discovery waiter is cancelled", async () => {
    let resolveDiscovery: (names: readonly string[]) => void = () => undefined;
    const discovery = new Promise<readonly string[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const processFactory = vi.fn(() => new FakeAppServerProcess());
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery: () => discovery,
      processFactory,
      workingDirectory: "/tmp/huayi-empty",
    });
    clients.add(client);
    const controller = new AbortController();
    const observation = observe(run(client, "discovery-cancelled", controller));

    await Promise.resolve();
    controller.abort();
    await vi.waitFor(() =>
      expect(observation.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" })),
    );
    resolveDiscovery([]);
    await Promise.resolve();

    expect(processFactory).not.toHaveBeenCalled();
    expect(observation).toMatchObject({
      rejection: expect.objectContaining({ code: "CANCELLED", retryable: false }),
      resolution: undefined,
    });
  });

  it("continues startup when another discovery waiter remains", async () => {
    let resolveDiscovery: (names: readonly string[]) => void = () => undefined;
    const discovery = new Promise<readonly string[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const process = new FakeAppServerProcess();
    const processFactory = vi.fn(() => process);
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery: () => discovery,
      processFactory,
      workingDirectory: "/tmp/huayi-empty",
    });
    clients.add(client);
    const firstController = new AbortController();
    const first = observe(run(client, "discovery-cancelled-first", firstController));
    const second = observe(run(client, "discovery-active-second", new AbortController()));

    await Promise.resolve();
    firstController.abort();
    await vi.waitFor(() =>
      expect(first.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" })),
    );
    resolveDiscovery(["node_repl"]);
    await process.takeRequest("initialize");

    expect(processFactory).toHaveBeenCalledOnce();
    expect(processFactory).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerNamesToDisable: ["node_repl"] }),
    );
    expect(second).toEqual({ rejection: undefined, resolution: undefined });
  });

  it("discovers MCP servers again after an App Server process failure", async () => {
    const firstProcess = new FakeAppServerProcess();
    const secondProcess = new FakeAppServerProcess();
    const processes = [firstProcess, secondProcess];
    let processIndex = 0;
    const mcpServerDiscovery = vi.fn(async (): Promise<readonly string[]> => []);
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery,
      processFactory: () => {
        const process = processes[processIndex];
        processIndex += 1;
        if (process === undefined) throw new Error("Missing fake App Server process.");
        return process;
      },
      workingDirectory: "/tmp/huayi-empty",
    });
    clients.add(client);
    const first = run(client, "discovery-crash", new AbortController());
    await firstProcess.takeRequest("initialize");
    firstProcess.emit("exit", 17, null);
    await expect(first).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });

    const second = observe(run(client, "discovery-restart", new AbortController()));
    await secondProcess.takeRequest("initialize");
    expect(mcpServerDiscovery).toHaveBeenCalledTimes(2);
    client.dispose();
    await vi.waitFor(() =>
      expect(second.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" })),
    );
  });
});
