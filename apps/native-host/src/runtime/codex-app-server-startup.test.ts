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

  notify(method: string, params?: unknown): void {
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

async function waitForMessage(process: FakeAppServerProcess, method: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.messages.some((message) => message.method === method)) return;
    await Promise.resolve();
  }
  throw new Error(`Missing ${method} message.`);
}

const clients = new Set<CodexAppServerClient>();
const startupPhases = ["initialize", "thread/start", "turn/start"] as const;
type StartupPhase = (typeof startupPhases)[number];

const safeThread = (id: string) => ({
  approvalPolicy: "never",
  cwd: "/tmp/huayi-empty",
  instructionSources: [],
  model: "gpt-5.4-mini",
  modelProvider: "openai",
  reasoningEffort: "low",
  sandbox: { networkAccess: false, type: "readOnly" },
  thread: { ephemeral: true, id },
});

function createClient(processes: FakeAppServerProcess[], timeoutMs = 100): CodexAppServerClient {
  let index = 0;
  const client = new CodexAppServerClient({
    codexExecutable: "codex",
    environment: { OPENAI_API_KEY: "must-not-leak" },
    processFactory: () => {
      const process = processes[index];
      index += 1;
      if (process === undefined) throw new Error("Missing fake App Server process.");
      return process;
    },
    timeoutMs,
    workingDirectory: "/tmp/huayi-empty",
  });
  clients.add(client);
  return client;
}

async function initialize(process: FakeAppServerProcess): Promise<void> {
  process.respond(await process.takeRequest("initialize"), {
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex",
  });
  await waitForMessage(process, "initialized");
  process.respond(await process.takeRequest("hooks/list"), { data: [] });
  process.respond(await process.takeRequest("mcpServerStatus/list"), {
    data: [],
    nextCursor: null,
  });
}

async function stallAt(process: FakeAppServerProcess, phase: StartupPhase): Promise<RpcMessage> {
  const initializeRequest = await process.takeRequest("initialize");
  if (phase === "initialize") return initializeRequest;
  process.respond(initializeRequest, {
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex",
  });
  await waitForMessage(process, "initialized");
  process.respond(await process.takeRequest("hooks/list"), { data: [] });
  process.respond(await process.takeRequest("mcpServerStatus/list"), {
    data: [],
    nextCursor: null,
  });
  const threadRequest = await process.takeRequest("thread/start");
  if (phase === "thread/start") return threadRequest;
  process.respond(threadRequest, safeThread("thread-startup"));
  return await process.takeRequest("turn/start");
}

interface Observation {
  rejection: unknown | undefined;
  resolution: string | undefined;
}

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
  deltas: string[] = [],
): Promise<string> {
  return client.runTurn({
    onAssistantDelta: (delta) => deltas.push(delta),
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

describe("CodexAppServerClient startup lifecycle", () => {
  it.each(startupPhases)("applies the total deadline while %s stalls", async (phase) => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const client = createClient([process]);
    const observation = observe(run(client, `timeout-${phase}`, new AbortController()));
    await stallAt(process, phase);

    await vi.advanceTimersByTimeAsync(1_101);

    expect(observation).toMatchObject({
      rejection: expect.objectContaining({ code: "TIMEOUT", retryable: true }),
      resolution: undefined,
    });
    expect(process.killCallCount).toBe(1);
  });

  it.each(
    startupPhases.flatMap(
      (phase) =>
        [
          [phase, "AbortSignal"],
          [phase, "interrupt"],
        ] as const,
    ),
  )("honors %s cancellation from %s startup", async (phase, cancellation) => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const client = createClient([process]);
    const controller = new AbortController();
    const requestId = `${cancellation}-${phase}`;
    const observation = observe(run(client, requestId, controller));
    await stallAt(process, phase);

    if (cancellation === "AbortSignal") controller.abort();
    else await client.interrupt(requestId);
    await vi.advanceTimersByTimeAsync(1_001);

    expect(observation).toMatchObject({
      rejection: expect.objectContaining({ code: "CANCELLED", retryable: false }),
      resolution: undefined,
    });
    expect(process.killCallCount).toBe(1);
  });

  it("rejects a duplicate request ID while initialization is pending", async () => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const client = createClient([process]);
    const first = observe(run(client, "duplicate", new AbortController()));
    await process.takeRequest("initialize");

    const duplicate = observe(run(client, "duplicate", new AbortController()));
    await vi.advanceTimersByTimeAsync(0);

    expect(first).toEqual({ rejection: undefined, resolution: undefined });
    expect(duplicate.rejection).toEqual(expect.objectContaining({ code: "INTERNAL_ERROR" }));
  });

  it("preserves capability mapping when process startup fails", async () => {
    vi.useFakeTimers();
    const client = createClient([]);
    const observation = observe(run(client, "spawn-failure", new AbortController()));

    await vi.advanceTimersByTimeAsync(0);

    expect(observation.rejection).toEqual(
      expect.objectContaining({ code: "CODEX_CAPABILITY_MISSING", retryable: false }),
    );
  });

  it("interrupts exactly once when turn/start supplies identity after cancellation", async () => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const client = createClient([process]);
    const deltas: string[] = [];
    const observation = observe(run(client, "late-identity", new AbortController(), deltas));
    const turnStart = await stallAt(process, "turn/start");

    await client.interrupt("late-identity");
    process.respond(turnStart, { turn: { id: "turn-late", status: "inProgress" } });
    await vi.advanceTimersByTimeAsync(0);
    const interrupts = process.messages.filter((message) => message.method === "turn/interrupt");
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]?.params).toEqual({ threadId: "thread-startup", turnId: "turn-late" });

    process.respond(interrupts[0] ?? { method: "turn/interrupt" }, {});
    process.notify("turn/completed", {
      threadId: "thread-startup",
      turn: { id: "turn-late", status: "interrupted" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(observation.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
    expect(process.killCallCount).toBe(0);

    process.notify("item/agentMessage/delta", {
      delta: "must stay ignored",
      itemId: "late-item",
      threadId: "thread-startup",
      turnId: "turn-late",
    });
    process.notify("item/completed", {
      item: { id: "late-item", text: "late", type: "agentMessage" },
      threadId: "thread-startup",
      turnId: "turn-late",
    });
    process.notify("turn/completed", {
      threadId: "thread-startup",
      turn: { id: "turn-late", status: "completed" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(deltas).toEqual([]);
    expect(observation.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
    expect(process.messages.filter((message) => message.method === "turn/interrupt")).toHaveLength(
      1,
    );
  });

  it("fails the shared session closed when cancelled startup has no turn identity", async () => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const client = createClient([process], 10_000);
    const active = observe(run(client, "active", new AbortController()));
    await initialize(process);
    process.respond(await process.takeRequest("thread/start"), safeThread("thread-active"));
    process.respond(await process.takeRequest("turn/start"), {
      turn: { id: "turn-active", status: "inProgress" },
    });
    await vi.advanceTimersByTimeAsync(0);

    const startup = observe(run(client, "startup", new AbortController()));
    await process.takeRequest("thread/start");
    await client.interrupt("startup");
    await vi.advanceTimersByTimeAsync(0);

    expect(startup.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
    expect(active.rejection).toEqual(expect.objectContaining({ code: "INTERNAL_ERROR" }));
    expect(process.killCallCount).toBe(1);
  });

  it("keeps an unrelated active turn alive when cancellation has a target", async () => {
    vi.useFakeTimers();
    const process = new FakeAppServerProcess();
    const client = createClient([process], 10_000);
    const first = observe(run(client, "first", new AbortController()));
    await initialize(process);
    process.respond(await process.takeRequest("thread/start"), safeThread("thread-first"));
    process.respond(await process.takeRequest("turn/start"), {
      turn: { id: "turn-first", status: "inProgress" },
    });
    const second = observe(run(client, "second", new AbortController()));
    process.respond(await process.takeRequest("thread/start"), safeThread("thread-second"));
    process.respond(await process.takeRequest("turn/start"), {
      turn: { id: "turn-second", status: "inProgress" },
    });
    await vi.advanceTimersByTimeAsync(0);

    await client.interrupt("first");
    const interrupt = await process.takeRequest("turn/interrupt");
    expect(interrupt.params).toEqual({ threadId: "thread-first", turnId: "turn-first" });
    expect(process.killCallCount).toBe(0);
    process.respond(interrupt, {});
    process.notify("turn/completed", {
      threadId: "thread-first",
      turn: { id: "turn-first", status: "interrupted" },
    });
    process.notify("item/completed", {
      item: { id: "item-second", text: "second-final", type: "agentMessage" },
      threadId: "thread-second",
      turnId: "turn-second",
    });
    process.notify("turn/completed", {
      threadId: "thread-second",
      turn: { id: "turn-second", status: "completed" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(first.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
    expect(second).toMatchObject({ resolution: "second-final" });
    expect(process.killCallCount).toBe(0);
  });
});
