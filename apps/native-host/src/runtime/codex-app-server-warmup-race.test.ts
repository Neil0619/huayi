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

const safeThread = {
  approvalPolicy: "never",
  cwd: "/tmp/huayi-empty",
  instructionSources: [],
  model: "gpt-5.4-mini",
  modelProvider: "openai",
  reasoningEffort: "low",
  sandbox: { networkAccess: false, type: "readOnly" },
  thread: { ephemeral: true, id: "thread-warmup-race" },
};

async function initialize(process: FakeAppServerProcess): Promise<void> {
  process.respond(await process.takeRequest("initialize"), {
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.messages.some((message) => message.method === "initialized")) break;
    await Promise.resolve();
  }
  process.respond(await process.takeRequest("hooks/list"), { data: [] });
  process.respond(await process.takeRequest("mcpServerStatus/list"), {
    data: [],
    nextCursor: null,
  });
}

describe("CodexAppServerClient warmup and analyze startup race", () => {
  it("shares one discovery, process and initialize request", async () => {
    const process = new FakeAppServerProcess();
    const discoverMcp = vi.fn(async () => []);
    const processFactory = vi.fn(() => process);
    const client = new CodexAppServerClient({
      codexExecutable: "codex",
      environment: {},
      mcpServerDiscovery: discoverMcp,
      processFactory,
      timeoutMs: 10_000,
      workingDirectory: "/tmp/huayi-empty",
    });
    try {
      const warming = client.warmup(new AbortController().signal);
      const turn = client.runTurn({
        onAssistantDelta: () => undefined,
        outputSchema: {},
        prompt: "untrusted text",
        requestId: "warmup-race",
        signal: new AbortController().signal,
      });

      await initialize(process);
      process.respond(await process.takeRequest("thread/start"), safeThread);
      process.respond(await process.takeRequest("turn/start"), {
        turn: { id: "turn-warmup-race", status: "inProgress" },
      });
      process.notify("item/completed", {
        item: { id: "item-warmup-race", text: "done", type: "agentMessage" },
        threadId: "thread-warmup-race",
        turnId: "turn-warmup-race",
      });
      process.notify("turn/completed", {
        threadId: "thread-warmup-race",
        turn: { id: "turn-warmup-race", status: "completed" },
      });

      await expect(Promise.all([warming, turn])).resolves.toEqual([undefined, "done"]);
      expect(discoverMcp).toHaveBeenCalledTimes(1);
      expect(processFactory).toHaveBeenCalledTimes(1);
      expect(process.messages.filter((message) => message.method === "initialize")).toHaveLength(1);
    } finally {
      client.dispose();
    }
  });
});
