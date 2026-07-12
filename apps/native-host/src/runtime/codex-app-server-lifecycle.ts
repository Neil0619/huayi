import type { AppServerEvent } from "./codex-app-server-protocol.js";
import { createTurnDeferred } from "./codex-app-server-protocol.js";
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
  runTurn(request: CodexTurnRequest): Promise<string>;
  interrupt(requestId: string): Promise<void>;
  dispose(): void;
}

export interface CodexAppServerClientOptions {
  codexExecutable: string;
  environment: Readonly<NodeJS.ProcessEnv>;
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
