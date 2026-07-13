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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

class FakeAppServerProcess extends EventEmitter implements JsonRpcProcess {
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly messages: RpcMessage[] = [];
  killCallCount = 0;
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
    this.killCallCount += 1;
    return true;
  }

  notify(method: string, params: unknown): void {
    this.stdout.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(request: RpcMessage, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
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

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolve === undefined) throw new Error("Deferred is unavailable.");
      resolve(value);
    },
  };
}

const clients = new Set<CodexAppServerClient>();

function createHarness(
  processes: FakeAppServerProcess[],
  discovery: () => Promise<readonly string[]> = async () => [],
  timeoutMs = 10_000,
) {
  let processIndex = 0;
  const discoverMcp = vi.fn(discovery);
  const processFactory = vi.fn(() => {
    const process = processes[processIndex];
    processIndex += 1;
    if (process === undefined) throw new Error("Missing fake App Server process.");
    return process;
  });
  const client = new CodexAppServerClient({
    codexExecutable: "codex",
    environment: {},
    mcpServerDiscovery: discoverMcp,
    processFactory,
    timeoutMs,
    workingDirectory: "/tmp/huayi-empty",
  });
  clients.add(client);
  return { client, discoverMcp, processFactory };
}

async function finishInitialization(
  process: FakeAppServerProcess,
  initializeRequest?: RpcMessage,
): Promise<void> {
  process.respond(initializeRequest ?? (await process.takeRequest("initialize")), {
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.messages.some((message) => message.method === "initialized")) break;
    await Promise.resolve();
  }
  expect(process.messages.some((message) => message.method === "initialized")).toBe(true);
  process.respond(await process.takeRequest("hooks/list"), { data: [] });
  process.respond(await process.takeRequest("mcpServerStatus/list"), {
    data: [],
    nextCursor: null,
  });
}

function safeThread(id: string) {
  return {
    approvalPolicy: "never",
    cwd: "/tmp/huayi-empty",
    instructionSources: [],
    model: "gpt-5.4-mini",
    modelProvider: "openai",
    reasoningEffort: "low",
    sandbox: { networkAccess: false, type: "readOnly" },
    thread: { ephemeral: true, id },
  };
}

function runTurn(
  client: CodexAppServerClient,
  requestId: string,
  controller = new AbortController(),
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
  vi.useRealTimers();
});

describe("CodexAppServerClient warmup lifecycle", () => {
  it("times out a stalled warmup and tears down its undemanded startup", async () => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process], async () => [], 100);
    let rejection: unknown;
    const warming = client.warmup(new AbortController().signal);
    void warming.catch((error: unknown) => {
      rejection = error;
    });
    await process.takeRequest("initialize");

    await vi.advanceTimersByTimeAsync(100);

    expect(rejection).toEqual(expect.objectContaining({ code: "TIMEOUT", retryable: true }));
    expect(process.killCallCount).toBe(1);
  });

  it("times out one warmup without tearing down startup demanded by analyze", async () => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process], async () => [], 100);
    let warmupRejection: unknown;
    const warming = client.warmup(new AbortController().signal);
    void warming.catch((error: unknown) => {
      warmupRejection = error;
    });
    const initializeRequest = await process.takeRequest("initialize");
    await vi.advanceTimersByTimeAsync(50);
    const turn = runTurn(client, "surviving-timeout");
    void turn.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(50);

    expect(warmupRejection).toEqual(expect.objectContaining({ code: "TIMEOUT", retryable: true }));
    expect(process.killCallCount).toBe(0);
    await finishInitialization(process, initializeRequest);
    process.respond(
      await process.takeRequest("thread/start"),
      safeThread("thread-surviving-timeout"),
    );
    process.respond(await process.takeRequest("turn/start"), {
      turn: { id: "turn-surviving-timeout", status: "inProgress" },
    });
    process.notify("item/completed", {
      item: { id: "item-surviving-timeout", text: "survived", type: "agentMessage" },
      threadId: "thread-surviving-timeout",
      turnId: "turn-surviving-timeout",
    });
    process.notify("turn/completed", {
      threadId: "thread-surviving-timeout",
      turn: { id: "turn-surviving-timeout", status: "completed" },
    });
    await expect(turn).resolves.toBe("survived");
    expect(process.killCallCount).toBe(0);
  });

  it("shares one startup between two concurrent warmups", async () => {
    const process = new FakeAppServerProcess();
    const { client, discoverMcp, processFactory } = createHarness([process]);
    const first = client.warmup(new AbortController().signal);
    const second = client.warmup(new AbortController().signal);

    await finishInitialization(process);

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(discoverMcp).toHaveBeenCalledTimes(1);
    expect(processFactory).toHaveBeenCalledTimes(1);
    expect(process.messages.filter((message) => message.method === "initialize")).toHaveLength(1);
  });

  it("cancels one warmup without tearing down startup demanded by another", async () => {
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process]);
    const firstController = new AbortController();
    const first = client.warmup(firstController.signal);
    const second = client.warmup(new AbortController().signal);
    const initializeRequest = await process.takeRequest("initialize");

    firstController.abort();
    await expect(first).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    expect(process.killCallCount).toBe(0);

    await finishInitialization(process, initializeRequest);
    await expect(second).resolves.toBeUndefined();
    expect(process.killCallCount).toBe(0);
  });

  it("does not create a process when the sole warmup cancels during MCP discovery", async () => {
    const discovery = createDeferred<readonly string[]>();
    const { client, discoverMcp, processFactory } = createHarness([], () => discovery.promise);
    const controller = new AbortController();
    const warming = client.warmup(controller.signal);
    await vi.waitFor(() => expect(discoverMcp).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(warming).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    discovery.resolve([]);
    await vi.waitFor(() => expect(processFactory).not.toHaveBeenCalled());
  });

  it("terminates initialization when its sole warmup demand is cancelled", async () => {
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process]);
    const controller = new AbortController();
    const warming = client.warmup(controller.signal);
    await process.takeRequest("initialize");

    controller.abort();

    await expect(warming).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    expect(process.killCallCount).toBe(1);
  });

  it("keeps analyze startup alive when a competing warmup is cancelled", async () => {
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process]);
    const warmupController = new AbortController();
    const warming = client.warmup(warmupController.signal);
    const turn = runTurn(client, "surviving-analyze");
    const initializeRequest = await process.takeRequest("initialize");

    warmupController.abort();
    await expect(warming).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    expect(process.killCallCount).toBe(0);

    await finishInitialization(process, initializeRequest);
    process.respond(
      await process.takeRequest("thread/start"),
      safeThread("thread-surviving-analyze"),
    );
    process.respond(await process.takeRequest("turn/start"), {
      turn: { id: "turn-surviving-analyze", status: "inProgress" },
    });
    process.notify("item/completed", {
      item: { id: "item-surviving-analyze", text: "survived", type: "agentMessage" },
      threadId: "thread-surviving-analyze",
      turnId: "turn-surviving-analyze",
    });
    process.notify("turn/completed", {
      threadId: "thread-surviving-analyze",
      turn: { id: "turn-surviving-analyze", status: "completed" },
    });

    await expect(turn).resolves.toBe("survived");
    expect(process.killCallCount).toBe(0);
  });

  it("keeps initialization alive when a competing analyze is cancelled", async () => {
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process]);
    const warming = client.warmup(new AbortController().signal);
    const turnController = new AbortController();
    const turn = runTurn(client, "cancelled-analyze", turnController);
    const initializeRequest = await process.takeRequest("initialize");

    turnController.abort();
    await expect(turn).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    expect(process.killCallCount).toBe(0);

    await finishInitialization(process, initializeRequest);
    await expect(warming).resolves.toBeUndefined();
    expect(process.messages.filter((message) => message.method === "thread/start")).toEqual([]);
    expect(process.messages.filter((message) => message.method === "turn/start")).toEqual([]);
    expect(process.killCallCount).toBe(0);
  });

  it("rejects warmup and terminates the process when disposed during initialization", async () => {
    const process = new FakeAppServerProcess();
    const { client } = createHarness([process]);
    const warming = client.warmup(new AbortController().signal);
    await process.takeRequest("initialize");

    client.dispose();

    await expect(warming).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    expect(process.killCallCount).toBe(1);
  });

  it("retries startup for analyze after warmup initialization fails", async () => {
    const firstProcess = new FakeAppServerProcess();
    const secondProcess = new FakeAppServerProcess();
    const { client, discoverMcp, processFactory } = createHarness([firstProcess, secondProcess]);
    const warming = client.warmup(new AbortController().signal);
    firstProcess.respond(await firstProcess.takeRequest("initialize"), {});

    await expect(warming).rejects.toMatchObject({
      code: "CODEX_CAPABILITY_MISSING",
      retryable: false,
    });
    expect(firstProcess.killCallCount).toBe(1);

    const turn = runTurn(client, "retry-analyze");
    await finishInitialization(secondProcess);
    secondProcess.respond(
      await secondProcess.takeRequest("thread/start"),
      safeThread("thread-retry-analyze"),
    );
    secondProcess.respond(await secondProcess.takeRequest("turn/start"), {
      turn: { id: "turn-retry-analyze", status: "inProgress" },
    });
    secondProcess.notify("item/completed", {
      item: { id: "item-retry-analyze", text: "recovered", type: "agentMessage" },
      threadId: "thread-retry-analyze",
      turnId: "turn-retry-analyze",
    });
    secondProcess.notify("turn/completed", {
      threadId: "thread-retry-analyze",
      turn: { id: "turn-retry-analyze", status: "completed" },
    });

    await expect(turn).resolves.toBe("recovered");
    expect(discoverMcp).toHaveBeenCalledTimes(2);
    expect(processFactory).toHaveBeenCalledTimes(2);
  });
});
