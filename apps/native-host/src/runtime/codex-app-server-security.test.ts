import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

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

  serverRequest(method: string, params: unknown): void {
    this.stdout.write(`${JSON.stringify({ id: 999, method, params })}\n`);
  }

  async takeRequest(method: string): Promise<RpcMessage> {
    await vi.waitFor(() => {
      expect(
        this.messages.find(
          (message) =>
            message.method === method && message.id !== undefined && !this.#taken.has(message.id),
        ),
      ).toBeDefined();
    });
    const request = this.messages.find(
      (message) =>
        message.method === method && message.id !== undefined && !this.#taken.has(message.id),
    );
    if (request?.id === undefined) throw new Error(`Missing ${method} request.`);
    this.#taken.add(request.id);
    return request;
  }
}

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

const safeHook = {
  cwd: "/tmp/huayi-empty",
  errors: [],
  hooks: [],
  warnings: [],
};

const inertMcp = {
  authStatus: "unsupported",
  name: "node_repl",
  resourceTemplates: [],
  resources: [],
  serverInfo: null,
  tools: {},
};

function createClient(process: FakeAppServerProcess): CodexAppServerClient {
  return new CodexAppServerClient({
    codexExecutable: "codex",
    environment: { OPENAI_API_KEY: "must-not-leak" },
    mcpServerDiscovery: async () => [],
    processFactory: () => process,
    workingDirectory: "/tmp/huayi-empty",
  });
}

async function initialize(
  process: FakeAppServerProcess,
  hooks: unknown[] = [],
  mcpServers: unknown[] = [],
): Promise<void> {
  process.respond(await process.takeRequest("initialize"), {
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex",
  });
  await vi.waitFor(() => expect(process.messages).toContainEqual({ method: "initialized" }));
  process.respond(await process.takeRequest("hooks/list"), { data: hooks });
  process.respond(await process.takeRequest("mcpServerStatus/list"), {
    data: mcpServers,
    nextCursor: null,
  });
}

async function startTurn(
  process: FakeAppServerProcess,
  requestId: string,
  hooks: unknown[] = [],
  mcpServers: unknown[] = [],
) {
  const promise = createClient(process).runTurn({
    onAssistantDelta: () => undefined,
    outputSchema: {},
    prompt: "untrusted page text",
    requestId,
    signal: new AbortController().signal,
  });
  await initialize(process, hooks, mcpServers);
  const threadId = `thread-${requestId}`;
  process.respond(await process.takeRequest("thread/start"), safeThread(threadId));
  const turnId = `turn-${requestId}`;
  process.respond(await process.takeRequest("turn/start"), {
    turn: { id: turnId, status: "inProgress" },
  });
  await Promise.resolve();
  return { promise, threadId, turnId };
}

describe("CodexAppServerClient security invariants", () => {
  it("accepts safe Hook and inert MCP records before starting a thread", async () => {
    const process = new FakeAppServerProcess();
    const active = await startTurn(process, "safe-records", [safeHook], [inertMcp]);
    process.notify("item/completed", {
      item: { id: "safe-records", text: "safe", type: "agentMessage" },
      threadId: active.threadId,
      turnId: active.turnId,
    });
    process.notify("turn/completed", {
      threadId: active.threadId,
      turn: { id: active.turnId, status: "completed" },
    });

    await expect(active.promise).resolves.toBe("safe");
  });

  it.each([
    ["instruction sources", { ...safeThread("unsafe"), instructionSources: ["AGENTS.md"] }],
    [
      "writable sandbox",
      { ...safeThread("unsafe"), sandbox: { networkAccess: true, type: "workspaceWrite" } },
    ],
    ["wrong model provider", { ...safeThread("unsafe"), modelProvider: "custom" }],
    ["persistent thread", { ...safeThread("unsafe"), thread: { ephemeral: false, id: "unsafe" } }],
  ])("fails closed when thread/start reports %s", async (_name, response) => {
    const process = new FakeAppServerProcess();
    const run = createClient(process).runTurn({
      onAssistantDelta: () => undefined,
      outputSchema: {},
      prompt: "secret",
      requestId: "unsafe",
      signal: new AbortController().signal,
    });
    await initialize(process);
    process.respond(await process.takeRequest("thread/start"), response);
    await expect(run).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
    expect(process.killCallCount).toBe(1);
  });

  it.each([
    ["an active Hook record", [{ ...safeHook, hooks: [{}] }], []],
    ["an MCP record with tools", [], [{ ...inertMcp, tools: { run: {} } }]],
  ])("rejects %s before starting a thread", async (_name, hooks, mcpServers) => {
    const process = new FakeAppServerProcess();
    const run = createClient(process).runTurn({
      onAssistantDelta: () => undefined,
      outputSchema: {},
      prompt: "secret",
      requestId: "unsafe",
      signal: new AbortController().signal,
    });
    await initialize(process, hooks, mcpServers);
    await expect(run).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
    expect(process.messages.some((message) => message.method === "thread/start")).toBe(false);
  });

  it.each([
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabToolCall",
    "webSearch",
    "imageView",
    "imageGeneration",
    "hookPrompt",
  ])("fails closed when an active turn emits a %s item", async (type) => {
    const process = new FakeAppServerProcess();
    const active = await startTurn(process, "unsafe-item");
    process.notify("item/started", {
      item: { id: "unsafe", type },
      threadId: active.threadId,
      turnId: active.turnId,
    });
    await expect(active.promise).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
    expect(process.killCallCount).toBe(1);
  });

  it.each(["configWarning", "item/commandExecution/requestApproval", "tool/requestUserInput"])(
    "fails closed on the unsafe %s notification",
    async (method) => {
      const process = new FakeAppServerProcess();
      const active = await startTurn(process, "unsafe-notify");
      process.notify(method, { threadId: active.threadId, turnId: active.turnId });
      await expect(active.promise).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
      expect(process.killCallCount).toBe(1);
    },
  );

  it("maps a server-initiated approval request to a capability failure", async () => {
    const process = new FakeAppServerProcess();
    const active = await startTurn(process, "server-request");
    process.serverRequest("item/commandExecution/requestApproval", {
      command: "cat secret",
      threadId: active.threadId,
      turnId: active.turnId,
    });
    await expect(active.promise).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
    expect(process.killCallCount).toBe(1);
  }, 1_000);

  it("requires exactly one authoritative completed agent message", async () => {
    const process = new FakeAppServerProcess();
    const active = await startTurn(process, "duplicate");
    for (const id of ["first", "second"]) {
      process.notify("item/completed", {
        item: { id, text: id, type: "agentMessage" },
        threadId: active.threadId,
        turnId: active.turnId,
      });
    }
    await expect(active.promise).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
  });
});
