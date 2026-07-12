import { isAbsolute } from "node:path";

import {
  createNodeAppServerProcess,
  type NodeAppServerProcessOptions,
} from "./codex-app-server-config.js";
import {
  AppServerInvariantError,
  SAFE_APP_SERVER_ITEM_TYPES,
  createTurnDeferred,
  parseAppServerNotification,
  initializeAppServerChannel,
  startAppServerThread,
  startAppServerTurn,
  type AppServerEvent,
  type ItemEvent,
} from "./codex-app-server-protocol.js";
import { MonitoredJsonRpcProcess } from "./codex-app-server-process-monitor.js";
import {
  DEFAULT_MAXIMUM_OUTPUT_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS,
  buildAllowedEnvironment,
} from "./codex-process.js";
import {
  CodexProviderError,
  capabilityMissingError,
  mapCodexProcessFailure,
  mapCodexTurnFailure,
} from "./error-mapper.js";
import {
  JsonRpcChannel,
  type JsonRpcNotification,
  type JsonRpcProcess,
} from "./json-rpc-channel.js";

export { APP_SERVER_ARGUMENTS, createNodeAppServerProcess } from "./codex-app-server-config.js";
export type { NodeAppServerProcessOptions } from "./codex-app-server-config.js";

const INTERRUPT_GRACE_MS = 1_000;

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

interface Session {
  channel: JsonRpcChannel;
  closed: boolean;
  failure?: CodexProviderError;
  ready: boolean;
}

interface ActiveTurn {
  abort(): void;
  agentItemId?: string;
  cancellation?: CodexProviderError;
  completedAgentItems: number;
  finalText?: string;
  graceTimer?: NodeJS.Timeout;
  interruptStarted: boolean;
  notifications: AppServerEvent[];
  reject(reason: CodexProviderError): void;
  request: CodexTurnRequest;
  resolve(text: string): void;
  session: Session;
  threadId: string;
  timeoutTimer?: NodeJS.Timeout;
  turnId?: string;
}

function cancelledError(): CodexProviderError {
  return mapCodexProcessFailure({ aborted: true, exitCode: null, stderr: "" });
}

function timeoutError(): CodexProviderError {
  return mapCodexProcessFailure({ exitCode: null, stderr: "", timedOut: true });
}

export class CodexAppServerClient implements CodexAppServer {
  readonly #activeTurns = new Map<string, ActiveTurn>();
  readonly #codexExecutable: string;
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  readonly #processFactory: (options: NodeAppServerProcessOptions) => JsonRpcProcess;
  readonly #timeoutMs: number;
  readonly #workingDirectory: string;
  #disposed = false;
  #session: Session | undefined;
  #sessionPromise: Promise<Session> | undefined;

  constructor(options: CodexAppServerClientOptions) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    if (!isAbsolute(options.workingDirectory)) {
      throw new TypeError("Codex App Server working directory must be absolute.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("Codex App Server timeout must be a positive integer.");
    }
    this.#codexExecutable = options.codexExecutable;
    this.#environment = buildAllowedEnvironment(options.environment);
    this.#processFactory = options.processFactory ?? createNodeAppServerProcess;
    this.#timeoutMs = timeoutMs;
    this.#workingDirectory = options.workingDirectory;
  }

  async runTurn(request: CodexTurnRequest): Promise<string> {
    if (this.#disposed || request.signal.aborted) throw cancelledError();
    if (this.#activeTurns.has(request.requestId)) throw mapCodexTurnFailure(undefined);
    const session = await this.#ensureSession();
    const thread = await this.#startThread(session);
    if (request.signal.aborted) throw cancelledError();

    const deferred = createTurnDeferred();
    const active: ActiveTurn = {
      abort: () => this.#cancel(active, cancelledError()),
      completedAgentItems: 0,
      interruptStarted: false,
      notifications: [],
      reject: deferred.reject,
      request,
      resolve: deferred.resolve,
      session,
      threadId: thread.thread.id,
    };
    this.#activeTurns.set(request.requestId, active);
    request.signal.addEventListener("abort", active.abort, { once: true });

    try {
      const turn = await startAppServerTurn(
        session.channel,
        this.#workingDirectory,
        active.threadId,
        request,
      );
      active.turnId = turn.turn.id;
    } catch (error) {
      if (error instanceof AppServerInvariantError) {
        this.#failSession(session, capabilityMissingError());
      } else {
        this.#reject(active, mapCodexTurnFailure(error));
      }
      return await deferred.promise;
    }
    active.timeoutTimer = setTimeout(() => this.#cancel(active, timeoutError()), this.#timeoutMs);
    active.timeoutTimer.unref();
    for (const notification of active.notifications.splice(0)) {
      this.#routeEvent(session, notification);
    }
    if (request.signal.aborted) this.#cancel(active, cancelledError());
    return await deferred.promise;
  }

  async interrupt(requestId: string): Promise<void> {
    const active = this.#activeTurns.get(requestId);
    if (active !== undefined) this.#cancel(active, cancelledError());
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const reason = cancelledError();
    for (const active of this.#activeTurns.values()) {
      if (active.turnId !== undefined) {
        void active.session.channel
          .request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId })
          .catch(() => undefined);
      }
    }
    if (this.#session !== undefined) this.#failSession(this.#session, reason);
  }

  async #ensureSession(): Promise<Session> {
    if (this.#disposed) throw cancelledError();
    if (this.#session?.ready === true) return this.#session;
    if (this.#sessionPromise !== undefined) return await this.#sessionPromise;
    const pending = this.#startSession();
    this.#sessionPromise = pending;
    const clearPending = (): void => {
      if (this.#sessionPromise === pending) this.#sessionPromise = undefined;
    };
    void pending.then(clearPending, clearPending);
    return await pending;
  }

  async #startSession(): Promise<Session> {
    let process: JsonRpcProcess;
    try {
      process = this.#processFactory({
        codexExecutable: this.#codexExecutable,
        environment: this.#environment,
        workingDirectory: this.#workingDirectory,
      });
    } catch {
      throw capabilityMissingError();
    }
    const sessionHolder: { current?: Session } = {};
    const monitoredProcess = new MonitoredJsonRpcProcess({
      isClosing: () => sessionHolder.current?.closed ?? true,
      onProcessFailure: () => {
        if (sessionHolder.current !== undefined) this.#processFailed(sessionHolder.current);
      },
      onProtocolFailure: () => {
        if (sessionHolder.current !== undefined) {
          this.#failSession(sessionHolder.current, capabilityMissingError());
        }
      },
      process,
    });
    const session: Session = {
      channel: new JsonRpcChannel({
        maximumLineBytes: DEFAULT_MAXIMUM_OUTPUT_BYTES,
        process: monitoredProcess,
      }),
      closed: false,
      ready: false,
    };
    sessionHolder.current = session;
    this.#session = session;
    session.channel.onNotification((notification) =>
      this.#handleNotification(session, notification),
    );
    try {
      await initializeAppServerChannel(session.channel, this.#workingDirectory);
      if (this.#disposed) throw cancelledError();
      session.ready = true;
      return session;
    } catch (error) {
      const reason =
        session.failure ?? (error instanceof CodexProviderError ? error : capabilityMissingError());
      this.#failSession(session, reason);
      throw reason;
    }
  }

  async #startThread(session: Session) {
    try {
      return await startAppServerThread(session.channel, this.#workingDirectory);
    } catch {
      const reason = session.failure ?? capabilityMissingError();
      this.#failSession(session, reason);
      throw reason;
    }
  }

  #handleNotification(session: Session, notification: JsonRpcNotification): void {
    if (session.closed) return;
    const event = parseAppServerNotification(notification);
    if (event.kind === "ignore") return;
    if (event.kind === "invalid" || event.kind === "unsafe") {
      this.#failSession(session, capabilityMissingError());
      return;
    }
    this.#routeEvent(session, event);
  }

  #routeEvent(session: Session, event: AppServerEvent): void {
    const active = [...this.#activeTurns.values()].find(
      (candidate) =>
        candidate.session === session &&
        candidate.threadId === event.threadId &&
        (candidate.turnId === undefined || candidate.turnId === event.turnId),
    );
    if (active === undefined) return;
    if (active.turnId === undefined) {
      active.notifications.push(event);
      return;
    }
    if (event.kind === "agentDelta") {
      this.#agentDelta(active, event.itemId, event.delta);
    } else if (event.kind === "item") {
      this.#itemEvent(active, event);
    } else {
      this.#turnCompleted(active, event.status, event.error);
    }
  }

  #agentDelta(active: ActiveTurn, itemId: string, delta: string): void {
    if (active.agentItemId !== undefined && active.agentItemId !== itemId) {
      this.#failSession(active.session, capabilityMissingError());
      return;
    }
    active.agentItemId = itemId;
    try {
      active.request.onAssistantDelta(delta);
    } catch {
      this.#cancel(active, cancelledError());
      this.#reject(active, mapCodexTurnFailure(undefined));
    }
  }

  #itemEvent(active: ActiveTurn, event: ItemEvent): void {
    if (!SAFE_APP_SERVER_ITEM_TYPES.has(event.item.type)) {
      this.#failSession(active.session, capabilityMissingError());
      return;
    }
    if (event.item.type !== "agentMessage") return;
    if (active.agentItemId !== undefined && active.agentItemId !== event.item.id) {
      this.#failSession(active.session, capabilityMissingError());
      return;
    }
    active.agentItemId = event.item.id;
    if (event.lifecycle === "completed") {
      active.completedAgentItems += 1;
      if (active.completedAgentItems !== 1 || typeof event.item.text !== "string") {
        this.#failSession(active.session, capabilityMissingError());
        return;
      }
      active.finalText = event.item.text;
    }
  }

  #turnCompleted(active: ActiveTurn, status: string, error: unknown): void {
    if (active.cancellation !== undefined) {
      this.#reject(active, active.cancellation);
    } else if (status === "failed") {
      this.#reject(active, mapCodexTurnFailure(error));
    } else if (status === "interrupted") {
      this.#reject(active, cancelledError());
    } else if (
      status === "completed" &&
      active.completedAgentItems === 1 &&
      active.finalText !== undefined
    ) {
      this.#resolve(active, active.finalText);
    } else {
      this.#failSession(active.session, capabilityMissingError());
    }
  }

  #cancel(active: ActiveTurn, reason: CodexProviderError): void {
    if (this.#activeTurns.get(active.request.requestId) !== active) return;
    active.cancellation ??= reason;
    if (active.timeoutTimer !== undefined) clearTimeout(active.timeoutTimer);
    if (active.turnId === undefined || active.interruptStarted) return;
    active.interruptStarted = true;
    active.graceTimer = setTimeout(
      () => this.#reject(active, active.cancellation ?? reason),
      INTERRUPT_GRACE_MS,
    );
    active.graceTimer.unref();
    void active.session.channel
      .request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId })
      .catch(() => undefined);
  }

  #processFailed(session: Session): void {
    this.#failSession(
      session,
      session.ready ? mapCodexTurnFailure(undefined) : capabilityMissingError(),
    );
  }

  #failSession(session: Session, reason: CodexProviderError): void {
    if (session.closed) return;
    session.closed = true;
    session.failure = reason;
    if (this.#session === session) this.#session = undefined;
    for (const active of [...this.#activeTurns.values()]) {
      if (active.session === session) this.#reject(active, reason);
    }
    session.channel.dispose(reason);
  }

  #resolve(active: ActiveTurn, text: string): void {
    if (this.#cleanup(active)) active.resolve(text);
  }

  #reject(active: ActiveTurn, reason: CodexProviderError): void {
    if (this.#cleanup(active)) active.reject(reason);
  }

  #cleanup(active: ActiveTurn): boolean {
    if (this.#activeTurns.get(active.request.requestId) !== active) return false;
    this.#activeTurns.delete(active.request.requestId);
    active.request.signal.removeEventListener("abort", active.abort);
    if (active.timeoutTimer !== undefined) clearTimeout(active.timeoutTimer);
    if (active.graceTimer !== undefined) clearTimeout(active.graceTimer);
    return true;
  }
}
