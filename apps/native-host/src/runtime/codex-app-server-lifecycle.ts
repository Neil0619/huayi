import {
  SAFE_APP_SERVER_ITEM_TYPES,
  createTurnDeferred,
  type AppServerEvent,
  type ItemEvent,
} from "./codex-app-server-protocol.js";
import type { NodeAppServerProcessOptions } from "./codex-app-server-config.js";
import { type CodexProviderError, mapCodexProcessFailure } from "./error-mapper.js";
import type { JsonRpcChannel, JsonRpcProcess } from "./json-rpc-channel.js";

export interface CodexTurnRequest {
  outputSchema: unknown;
  prompt: string;
  requestId: string;
  signal: AbortSignal;
  onAssistantDelta(delta: string): void;
}

export interface CodexAppServer {
  warmup(signal: AbortSignal): Promise<void>;
  runTurn(request: CodexTurnRequest): Promise<string>;
  interrupt(requestId: string): Promise<void>;
  dispose(): void;
}

export type McpServerDiscovery = () => Promise<readonly string[]>;

export interface CodexAppServerClientOptions {
  codexExecutable: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  mcpServerDiscovery: McpServerDiscovery;
  onTurnStartSent?: () => void;
  processFactory?: (options: NodeAppServerProcessOptions) => JsonRpcProcess;
  timeoutMs?: number;
  workingDirectory: string;
}

export interface AppServerSession {
  channel: JsonRpcChannel;
  closed: boolean;
  failure?: CodexProviderError;
  ready: boolean;
}

export interface ActiveTurn {
  abort(): void;
  agentItemId?: string;
  cancellation?: CodexProviderError;
  completedAgentItems: number;
  finalText?: string;
  graceTimer?: NodeJS.Timeout;
  interruptStarted: boolean;
  notifications: AppServerEvent[];
  promise: Promise<string>;
  reject(reason: CodexProviderError): void;
  request: CodexTurnRequest;
  resolve(text: string): void;
  session?: AppServerSession;
  threadId?: string;
  timeoutTimer?: NodeJS.Timeout;
  turnId?: string;
}

export function recordItemEvent(active: ActiveTurn, event: ItemEvent): boolean {
  if (!SAFE_APP_SERVER_ITEM_TYPES.has(event.item.type)) return false;
  if (event.item.type !== "agentMessage") return true;
  if (active.agentItemId !== undefined && active.agentItemId !== event.item.id) return false;
  active.agentItemId = event.item.id;
  if (event.lifecycle !== "completed") return true;
  active.completedAgentItems += 1;
  if (active.completedAgentItems !== 1 || typeof event.item.text !== "string") return false;
  active.finalText = event.item.text;
  return true;
}

export interface WarmupDemand {
  cancellation: Promise<never>;
  cancel(): void;
  release(): void;
}

export class WarmupDemandTracker {
  readonly #active = new Set<WarmupDemand>();
  readonly #onCancellation: () => void;

  constructor(onCancellation: () => void) {
    this.#onCancellation = onCancellation;
  }

  get size(): number {
    return this.#active.size;
  }

  create(signal: AbortSignal, timeoutMs: number): WarmupDemand {
    let rejectCancellation: (reason: CodexProviderError) => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const release = (): void => {
      if (!this.#active.delete(demand)) return;
      signal.removeEventListener("abort", demand.cancel);
      clearTimeout(timeoutTimer);
    };
    const cancel = (reason: CodexProviderError): void => {
      if (!this.#active.has(demand)) return;
      release();
      rejectCancellation(reason);
      this.#onCancellation();
    };
    const demand: WarmupDemand = {
      cancellation,
      cancel: () => cancel(cancelledError()),
      release,
    };
    this.#active.add(demand);
    signal.addEventListener("abort", demand.cancel, { once: true });
    const timeoutTimer = setTimeout(() => cancel(timeoutError()), timeoutMs);
    timeoutTimer.unref();
    return demand;
  }

  cancelAll(): void {
    for (const demand of [...this.#active]) demand.cancel();
  }
}

export function createActiveTurn(
  request: CodexTurnRequest,
  cancel: (active: ActiveTurn) => void,
): ActiveTurn {
  const deferred = createTurnDeferred();
  const active: ActiveTurn = {
    abort: () => cancel(active),
    completedAgentItems: 0,
    interruptStarted: false,
    notifications: [],
    promise: deferred.promise,
    reject: deferred.reject,
    request,
    resolve: deferred.resolve,
  };
  return active;
}

export function cancelledError(): CodexProviderError {
  return mapCodexProcessFailure({ aborted: true, exitCode: null, stderr: "" });
}

export function timeoutError(): CodexProviderError {
  return mapCodexProcessFailure({ exitCode: null, stderr: "", timedOut: true });
}
