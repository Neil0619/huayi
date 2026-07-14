import { isAbsolute } from "node:path";

import {
  createNodeAppServerProcess,
  type NodeAppServerProcessOptions,
} from "./codex-app-server-config.js";
import {
  AppServerInvariantError,
  parseAppServerNotification,
  initializeAppServerChannel,
  startAppServerThread,
  startAppServerTurn,
  type AppServerEvent,
} from "./codex-app-server-protocol.js";
import {
  cancelledError,
  createActiveTurn,
  timeoutError,
  type ActiveTurn,
  type CodexAppServer,
  type CodexAppServerClientOptions,
  type AppServerSession as Session,
  type CodexTurnRequest,
  type McpServerDiscovery,
  recordItemEvent,
  WarmupDemandTracker,
} from "./codex-app-server-lifecycle.js";
import { createAppServerSession } from "./codex-app-server-session.js";
import { DEFAULT_PROCESS_TIMEOUT_MS, buildAllowedEnvironment } from "./codex-process.js";
import { CodexProviderError, capabilityMissingError, mapCodexTurnFailure } from "./error-mapper.js";
import type { JsonRpcNotification, JsonRpcProcess } from "./json-rpc-channel.js";

export { APP_SERVER_ARGUMENTS, createNodeAppServerProcess } from "./codex-app-server-config.js";
export type { NodeAppServerProcessOptions } from "./codex-app-server-config.js";
export type {
  CodexAppServer,
  CodexAppServerClientOptions,
  CodexTurnRequest,
  McpServerDiscovery,
} from "./codex-app-server-lifecycle.js";

const INTERRUPT_GRACE_MS = 1_000;

export class CodexAppServerClient implements CodexAppServer {
  readonly #activeTurns = new Map<string, ActiveTurn>();
  readonly #codexExecutable: string;
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  readonly #mcpServerDiscovery: McpServerDiscovery;
  readonly #onTurnStartSent: (() => void) | undefined;
  readonly #processFactory: (options: NodeAppServerProcessOptions) => JsonRpcProcess;
  readonly #timeoutMs: number;
  readonly #workingDirectory: string;
  readonly #warmupDemands = new WarmupDemandTracker(() => this.#cancelUndemandedStartup());
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
    this.#mcpServerDiscovery = options.mcpServerDiscovery;
    this.#onTurnStartSent = options.onTurnStartSent;
    this.#processFactory = options.processFactory ?? createNodeAppServerProcess;
    this.#timeoutMs = timeoutMs;
    this.#workingDirectory = options.workingDirectory;
  }

  async warmup(signal: AbortSignal): Promise<void> {
    if (this.#disposed || signal.aborted) throw cancelledError();
    const demand = this.#warmupDemands.create(signal, this.#timeoutMs);
    try {
      await Promise.race([this.#ensureSession(), demand.cancellation]);
    } finally {
      demand.release();
    }
  }

  async runTurn(request: CodexTurnRequest): Promise<string> {
    if (this.#disposed || request.signal.aborted) throw cancelledError();
    if (this.#activeTurns.has(request.requestId)) throw mapCodexTurnFailure(undefined);
    const active = createActiveTurn(request, (candidate) =>
      this.#cancel(candidate, cancelledError()),
    );
    this.#activeTurns.set(request.requestId, active);
    request.signal.addEventListener("abort", active.abort, { once: true });
    active.timeoutTimer = setTimeout(() => this.#cancel(active, timeoutError()), this.#timeoutMs);
    active.timeoutTimer.unref();
    void this.#runReservedTurn(active);
    return await active.promise;
  }

  async #runReservedTurn(active: ActiveTurn): Promise<void> {
    try {
      const pendingSession = this.#ensureSession();
      if (this.#session !== undefined) active.session = this.#session;
      const session = await pendingSession;
      if (!this.#isActive(active)) return;
      active.session = session;
      const thread = await this.#startThread(session);
      if (!this.#isActive(active)) return;
      active.threadId = thread.thread.id;
      const turn = await startAppServerTurn(
        session.channel,
        this.#workingDirectory,
        active.threadId,
        active.request,
        this.#onTurnStartSent,
      );
      active.turnId = turn.turn.id;
      if (active.cancellation !== undefined) this.#interruptActive(active);
      for (const notification of active.notifications.splice(0)) {
        this.#routeEvent(session, notification);
      }
    } catch (error) {
      if (!this.#isActive(active)) return;
      if (error instanceof AppServerInvariantError) {
        const reason = capabilityMissingError();
        if (active.session === undefined) this.#reject(active, reason);
        else this.#failSession(active.session, reason);
      } else {
        this.#reject(
          active,
          error instanceof CodexProviderError ? error : mapCodexTurnFailure(error),
        );
      }
    }
  }

  async interrupt(requestId: string): Promise<void> {
    const active = this.#activeTurns.get(requestId);
    if (active !== undefined) this.#cancel(active, cancelledError());
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const reason = cancelledError();
    this.#warmupDemands.cancelAll();
    for (const active of [...this.#activeTurns.values()]) {
      if (
        !active.interruptStarted &&
        active.session !== undefined &&
        active.threadId !== undefined &&
        active.turnId !== undefined
      ) {
        active.interruptStarted = true;
        void active.session.channel
          .request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId })
          .catch(() => undefined);
      }
      this.#reject(active, reason);
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
      const mcpServerNamesToDisable = await this.#mcpServerDiscovery();
      if (this.#disposed || !this.#hasSessionDemand()) throw cancelledError();
      process = this.#processFactory({
        codexExecutable: this.#codexExecutable,
        environment: this.#environment,
        mcpServerNamesToDisable,
        workingDirectory: this.#workingDirectory,
      });
    } catch (error) {
      if (error instanceof CodexProviderError && error.code === "CANCELLED") throw error;
      throw capabilityMissingError(error);
    }
    const session = createAppServerSession({
      onProcessFailure: (failedSession) => this.#processFailed(failedSession),
      onProtocolFailure: (failedSession) =>
        this.#failSession(failedSession, capabilityMissingError()),
      process,
    });
    this.#session = session;
    for (const active of this.#activeTurns.values()) {
      if (active.session === undefined) active.session = session;
    }
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
      this.#agentDelta(active, session, event.itemId, event.delta);
    } else if (event.kind === "item") {
      if (!recordItemEvent(active, event)) this.#failSession(session, capabilityMissingError());
    } else {
      this.#turnCompleted(active, session, event.status, event.error);
    }
  }

  #agentDelta(active: ActiveTurn, session: Session, itemId: string, delta: string): void {
    if (active.agentItemId !== undefined && active.agentItemId !== itemId) {
      this.#failSession(session, capabilityMissingError());
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

  #turnCompleted(active: ActiveTurn, session: Session, status: string, error: unknown): void {
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
      if (this.#cleanup(active)) active.resolve(active.finalText);
    } else {
      this.#failSession(session, capabilityMissingError());
    }
  }

  #cancel(active: ActiveTurn, reason: CodexProviderError): void {
    if (!this.#isActive(active)) return;
    active.cancellation ??= reason;
    if (active.timeoutTimer !== undefined) clearTimeout(active.timeoutTimer);
    if (active.turnId !== undefined) {
      this.#interruptActive(active);
    } else if (active.threadId !== undefined) {
      this.#armCancellationGrace(active);
    } else {
      this.#failUnidentifiedStartup(active);
    }
  }

  #interruptActive(active: ActiveTurn): void {
    if (
      !this.#isActive(active) ||
      active.interruptStarted ||
      active.session === undefined ||
      active.threadId === undefined ||
      active.turnId === undefined
    ) {
      return;
    }
    active.interruptStarted = true;
    this.#armCancellationGrace(active);
    void active.session.channel
      .request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId })
      .catch(() => undefined);
  }

  #armCancellationGrace(active: ActiveTurn): void {
    if (active.graceTimer !== undefined) return;
    active.graceTimer = setTimeout(() => {
      if (!this.#isActive(active)) return;
      if (active.turnId === undefined) this.#failUnidentifiedStartup(active);
      else this.#reject(active, active.cancellation ?? cancelledError());
    }, INTERRUPT_GRACE_MS);
    active.graceTimer.unref();
  }

  #failUnidentifiedStartup(active: ActiveTurn): void {
    const session = active.session;
    const reason = active.cancellation ?? cancelledError();
    const hasUnrelatedWork =
      session !== undefined &&
      [...this.#activeTurns.values()].some(
        (candidate) => candidate !== active && candidate.session === session,
      );
    const warmupNeedsSession = session !== undefined && this.#warmupDemands.size > 0;
    if (!this.#cleanup(active)) return;
    if (session !== undefined && !session.closed && !hasUnrelatedWork && !warmupNeedsSession) {
      this.#failSession(session, mapCodexTurnFailure(undefined));
    }
    active.reject(reason);
  }

  #cancelUndemandedStartup(): void {
    const session = this.#session;
    if (session !== undefined && !session.ready && !this.#hasSessionDemand()) {
      this.#failSession(session, cancelledError());
    }
  }

  #hasSessionDemand(): boolean {
    return this.#activeTurns.size > 0 || this.#warmupDemands.size > 0;
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
    if (this.#session === session) {
      this.#session = undefined;
      this.#sessionPromise = undefined;
    }
    for (const active of [...this.#activeTurns.values()]) {
      if (active.session === session) this.#reject(active, reason);
    }
    session.channel.dispose(reason);
  }

  #reject(active: ActiveTurn, reason: CodexProviderError): void {
    if (this.#cleanup(active)) active.reject(reason);
  }

  #isActive(active: ActiveTurn): boolean {
    return this.#activeTurns.get(active.request.requestId) === active;
  }

  #cleanup(active: ActiveTurn): boolean {
    if (!this.#isActive(active)) return false;
    this.#activeTurns.delete(active.request.requestId);
    active.request.signal.removeEventListener("abort", active.abort);
    if (active.timeoutTimer !== undefined) clearTimeout(active.timeoutTimer);
    if (active.graceTimer !== undefined) clearTimeout(active.graceTimer);
    return true;
  }
}
