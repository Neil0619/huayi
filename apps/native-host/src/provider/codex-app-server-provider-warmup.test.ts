import { describe, expect, it } from "vitest";

import type { CodexAppServer, CodexTurnRequest } from "../runtime/codex-app-server-lifecycle.js";
import { CodexAppServerProvider } from "./codex-app-server-provider.js";

class FakeAppServer implements CodexAppServer {
  readonly warmupSignals: AbortSignal[] = [];
  disposeCalls = 0;
  runTurnCalls = 0;

  warmup(signal: AbortSignal): Promise<void> {
    this.warmupSignals.push(signal);
    return Promise.resolve();
  }

  runTurn(request: CodexTurnRequest): Promise<string> {
    void request;
    this.runTurnCalls += 1;
    return Promise.reject(new Error("Unexpected model turn."));
  }

  interrupt(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

describe("CodexAppServerProvider warmup", () => {
  it("delegates directly without loading a schema or starting a turn", async () => {
    const appServer = new FakeAppServer();
    const provider = new CodexAppServerProvider({
      appServer,
      schemaDirectory: "/Applications/Huayi/provider/schemas",
    });
    const signal = new AbortController().signal;

    await expect(provider.warmup(signal)).resolves.toBeUndefined();

    expect(appServer.warmupSignals).toEqual([signal]);
    expect(appServer.runTurnCalls).toBe(0);
  });
});
